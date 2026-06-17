import { createClient } from "@/lib/supabase/server";

// Shared read queries for the listener's door: the public Browse feed and
// Search. Both return the same `FeedWork` shape so cards render uniformly.
//
// Live-only filtering is owed to RLS (`work_read_live_or_owner` returns drafts
// only to their creator); the anon/session client cannot see them otherwise.
// We still pass `.eq("status","live")` so the query plan stays predictable for
// the signed-in owner case.

export type FeedWork = {
  id: number;
  title: string;
  artwork_url: string | null;
  duration_seconds: number | null;
  red_line_certified: boolean;
  created_at: string;
  // The HLS playlist key makes every card directly enqueueable by the global
  // player (Phase 5). Live works all carry one.
  hls_playlist_key: string | null;
  contributors: { name: string; profile_slug: string | null }[];
  // Real listens, recorded server-side (src/lib/plays). Denormalized onto `work`
  // and kept exact by a trigger, so it rides free with every work select — no
  // extra round trip.
  playCount: number;
};

// v1 caps the door at a reasonable slice — pagination is deferred (a later
// phase of discovery, per CLAUDE.md §5). Plenty of headroom for launch.
export const FEED_LIMIT = 60;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type WorkRow = {
  id: number;
  title: string;
  artwork_url: string | null;
  duration_seconds: number | null;
  red_line_certified: boolean;
  created_at: string;
  hls_playlist_key: string | null;
  play_count: number | null;
  public_volley: Array<{
    agent: { name: string; profile_slug: string | null } | null;
  }>;
};

const WORK_SELECT =
  "id, title, artwork_url, duration_seconds, red_line_certified, created_at, hls_playlist_key, play_count, public_volley(agent(name, profile_slug))";

// A single agent may appear on several volleys per work; collapse by slug-or-name
// so the contributor line / chips don't repeat. Generic over the agent shape so
// callers carrying extra fields (id, type, …) keep them through the dedupe.
type AgentLite = { name: string; profile_slug: string | null };
export function dedupeContributors<A extends AgentLite>(
  rows: ReadonlyArray<{ agent: A | null } | null | undefined> | null | undefined,
): A[] {
  const seen = new Set<string>();
  const out: A[] = [];
  for (const row of rows ?? []) {
    const a = row?.agent;
    if (!a) continue;
    const key = (a.profile_slug ?? a.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

// Reshape a hydrated row into a card-ready FeedWork.
function shape(row: WorkRow): FeedWork {
  return {
    id: row.id,
    title: row.title,
    artwork_url: row.artwork_url,
    duration_seconds: row.duration_seconds,
    red_line_certified: row.red_line_certified,
    created_at: row.created_at,
    hls_playlist_key: row.hls_playlist_key,
    playCount: row.play_count ?? 0,
    contributors: dedupeContributors(row.public_volley),
  };
}

// Public Browse feed: live works, newest first.
export async function getFeed(
  supabase: SupabaseServerClient,
  limit = FEED_LIMIT,
): Promise<FeedWork[]> {
  const { data } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as WorkRow[]).map(shape);
}

// One live work, card-ready (same shape as the feed). Used by the per-song
// share preview (registry/[id]/opengraph-image) so the link card is built from
// the same dedupe + embed as the browse cards. Returns null for missing,
// non-live, or unreadable rows — never throws — so the OG renderer can degrade
// to a neutral AIRED fallback rather than crashing the share unfurl.
export async function getWorkById(
  supabase: SupabaseServerClient,
  workId: number,
): Promise<FeedWork | null> {
  if (!Number.isInteger(workId) || workId <= 0) return null;
  const { data } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .eq("id", workId)
    .eq("status", "live")
    .maybeSingle();
  return data ? shape(data as unknown as WorkRow) : null;
}

// "1", "0001", "AIRED-0001", "aired 1" → 1; anything else → null.
export function parseCatalogQuery(q: string): number | null {
  const cleaned = q.trim().replace(/^aired[-\s_]?/i, "");
  if (!/^\d+$/.test(cleaned)) return null;
  const n = Number.parseInt(cleaned, 10);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

// Search live works by title, catalog number, or contributor name. Same shape
// as the feed so the home page renders both with one card. Live-only by RLS.
export async function searchWorks(
  supabase: SupabaseServerClient,
  query: string,
  limit = FEED_LIMIT,
): Promise<FeedWork[]> {
  const q = query.trim();
  if (!q) return [];

  const num = parseCatalogQuery(q);
  const matched = new Set<number>();

  // Title contains. ilike wildcards (% and _) in user input just widen the
  // match — supabase-js URL-encodes the value, so no injection surface.
  // Contributor name via an inner-join embed on agent: the join + the agent.name
  // filter both constrain the public_volley rows the server returns.
  const [titleRes, contribRes] = await Promise.all([
    supabase
      .from("work")
      .select("id")
      .eq("status", "live")
      .ilike("title", `%${q}%`)
      .limit(limit),
    supabase
      .from("public_volley")
      .select("work_id, agent:agent_id!inner(name)")
      .ilike("agent.name", `%${q}%`)
      .limit(limit),
  ]);

  for (const r of (titleRes.data ?? []) as { id: number }[]) matched.add(r.id);
  for (const r of (contribRes.data ?? []) as {
    work_id: number;
    agent: unknown;
  }[]) {
    if (r.agent) matched.add(r.work_id);
  }
  // Catalog hit: the hydration step's .in() + status=live double-checks it
  // exists and is live, so we can speculatively add it.
  if (num !== null) matched.add(num);

  if (matched.size === 0) return [];

  const { data } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .in("id", Array.from(matched))
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as WorkRow[]).map(shape);
}

// The "Most played" strip: live works ranked by real listens, highest first
// (ties broken by catalog number for a stable order), each card-ready with its
// count. A plain ORDER BY on the denormalized counter — empty until plays land.
export async function getMostPlayed(
  supabase: SupabaseServerClient,
  limit = 10,
): Promise<FeedWork[]> {
  const { data } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .eq("status", "live")
    .gt("play_count", 0)
    .order("play_count", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  return ((data ?? []) as unknown as WorkRow[]).map(shape);
}
