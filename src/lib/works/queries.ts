import { createClient } from "@/lib/supabase/server";

// Shared read queries for the listener's door: the public Browse feed and
// Search. Both return the same `FeedWork` shape so cards render uniformly.
//
// Live-only filtering is owed to RLS (`work_read_live_or_owner` returns drafts
// only to their creator, and hides a taken_down work from everyone but its
// owner); the anon/session client cannot see them otherwise. We still pass
// `.eq("status","live").eq("taken_down", false)` explicitly on every public read
// so the signed-in owner / admin (who CAN read those rows) never leaks one onto
// a public surface, and the query plan stays predictable.

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
  // The album this work is filed under, or null for a single. Carried on the
  // feed so Browse can split the catalog into an album shelf + a singles shelf
  // (BROWSE-AS-LABEL) without a second query. Cards ignore it.
  album_id: string | null;
  // The owner-set teaser window for the share video (the per-song Reels / TikTok
  // clip). Carried here so the /share/song/[id]/video route can build the
  // versioned clip key without a second read; cards ignore it. Null → the
  // worker's default window (start 0, length 40).
  clip_start_seconds: number | null;
  clip_length_seconds: number | null;
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
  album_id: string | null;
  play_count: number | null;
  clip_start_seconds: number | null;
  clip_length_seconds: number | null;
  public_volley: Array<{
    agent: { name: string; profile_slug: string | null } | null;
  }>;
};

const WORK_SELECT =
  "id, title, artwork_url, duration_seconds, red_line_certified, created_at, hls_playlist_key, album_id, play_count, clip_start_seconds, clip_length_seconds, public_volley(agent(name, profile_slug))";

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
    album_id: row.album_id,
    clip_start_seconds: row.clip_start_seconds,
    clip_length_seconds: row.clip_length_seconds,
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
    .eq("taken_down", false)
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
    .eq("taken_down", false)
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

// Search live works by title, catalog number, or contributor name — and, because
// Browse is now a label, also by ALBUM title and ARTIST (creator) name, expanding
// either into its live works. Same FeedWork shape so the home page renders the
// hits with one card. Live-only is enforced on every leg (RLS + explicit
// status='live'), so search never surfaces a draft / in-review work.
export async function searchWorks(
  supabase: SupabaseServerClient,
  query: string,
  limit = FEED_LIMIT,
): Promise<FeedWork[]> {
  const q = query.trim();
  if (!q) return [];

  const num = parseCatalogQuery(q);
  const matched = new Set<number>();
  // ilike wildcards (% and _) in user input just widen the match — supabase-js
  // URL-encodes the value, so there's no injection surface.
  const pattern = `%${q}%`;

  // First pass, in parallel: direct work hits (title, contributor agent name) and
  // the two label dimensions (album title, artist display_name) we expand below.
  // Contributor name uses an inner-join embed on agent: the join + the agent.name
  // filter both constrain the public_volley rows the server returns.
  const [titleRes, contribRes, albumRes, artistRes] = await Promise.all([
    supabase
      .from("work")
      .select("id")
      .eq("status", "live")
      .eq("taken_down", false)
      .ilike("title", pattern)
      .limit(limit),
    supabase
      .from("public_volley")
      .select("work_id, agent:agent_id!inner(name)")
      .ilike("agent.name", pattern)
      .limit(limit),
    supabase.from("album").select("id").ilike("title", pattern).limit(limit),
    supabase
      .from("profile")
      .select("id")
      .ilike("display_name", pattern)
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

  // Second pass: expand matched albums / artists into their LIVE works.
  const albumIds = ((albumRes.data ?? []) as { id: string }[]).map((a) => a.id);
  const artistIds = ((artistRes.data ?? []) as { id: string }[]).map(
    (p) => p.id,
  );
  const [albumWorks, artistWorks] = await Promise.all([
    albumIds.length
      ? supabase
          .from("work")
          .select("id")
          .eq("status", "live")
          .eq("taken_down", false)
          .in("album_id", albumIds)
          .limit(limit)
      : Promise.resolve({ data: [] as { id: number }[] }),
    artistIds.length
      ? supabase
          .from("work")
          .select("id")
          .eq("status", "live")
          .eq("taken_down", false)
          .in("creator_id", artistIds)
          .limit(limit)
      : Promise.resolve({ data: [] as { id: number }[] }),
  ]);
  for (const r of (albumWorks.data ?? []) as { id: number }[]) matched.add(r.id);
  for (const r of (artistWorks.data ?? []) as { id: number }[])
    matched.add(r.id);

  if (matched.size === 0) return [];

  const { data } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .in("id", Array.from(matched))
    .eq("status", "live")
    .eq("taken_down", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as WorkRow[]).map(shape);
}

export type DraftWork = {
  id: number;
  title: string;
  artworkUrl: string | null;
  createdAt: string;
};

// The signed-in creator's unpublished drafts (EDIT & TIDY — Resume). Surfaced on
// /upload so a creator continues an in-progress work rather than starting fresh
// and minting another orphan. Owner-scoped (status='draft' + creator_id), and
// RLS (work_read_live_or_owner) backs that — a draft is only ever its creator's.
export async function getMyDrafts(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<DraftWork[]> {
  const { data } = await supabase
    .from("work")
    .select("id, title, artwork_url, created_at")
    .eq("creator_id", userId)
    .eq("status", "draft")
    .order("id", { ascending: false });
  return (
    (data ?? []) as Array<{
      id: number;
      title: string;
      artwork_url: string | null;
      created_at: string;
    }>
  ).map((w) => ({
    id: w.id,
    title: w.title,
    artworkUrl: w.artwork_url,
    createdAt: w.created_at,
  }));
}

// The "Most Aired" strip: live works ranked by real listens, highest first
// (ties broken by catalog number for a stable order), each card-ready with its
// count. A plain ORDER BY on the denormalized counter — empty until plays land.
// This is the one cross-artist, mixed row on Browse (no artist grouping).
export async function getMostAired(
  supabase: SupabaseServerClient,
  limit = 10,
): Promise<FeedWork[]> {
  const { data } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .eq("status", "live")
    .eq("taken_down", false)
    .gt("play_count", 0)
    .order("play_count", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  return ((data ?? []) as unknown as WorkRow[]).map(shape);
}

// The LIVE songs filed in one album, in catalog (track) order — the album page's
// body and its play queue (BROWSE-AS-LABEL). status='live' is filtered EXPLICITLY,
// not left to RLS: an admin (work_admin_read) or the album owner can read non-live
// rows, but a public album page must never surface a draft / in-review song. So a
// pending or draft work filed in this album simply never appears here.
export async function getAlbumSongs(
  supabase: SupabaseServerClient,
  albumId: string,
): Promise<FeedWork[]> {
  const { data } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .eq("album_id", albumId)
    .eq("status", "live")
    .eq("taken_down", false)
    .order("id", { ascending: true });
  return ((data ?? []) as unknown as WorkRow[]).map(shape);
}

// An artist's album-less LIVE works — their singles shelf on the artist page.
// creator_id scopes to the one artist; the explicit status='live' keeps it
// public-safe (same reasoning as getAlbumSongs — never trust RLS alone here).
export async function getArtistSingles(
  supabase: SupabaseServerClient,
  profileId: string,
  limit = FEED_LIMIT,
): Promise<FeedWork[]> {
  const { data } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .eq("creator_id", profileId)
    .eq("status", "live")
    .eq("taken_down", false)
    .is("album_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as unknown as WorkRow[]).map(shape);
}

// ── Browse-as-label, artist-grouped shelves ────────────────────────────────
// The Listen page bands ALBUMS and SINGLES into one horizontal row PER ARTIST.
// Rows are ordered by the artist's total live play_count (most-aired first), so
// both shelves share one per-artist stat: total listens + the newest work time
// (the tie-breaker). Keyed by creator_id — which, by the album-ownership trigger,
// equals an album's profile_id for every song it holds — so an album row and a
// single row for the same artist resolve to the same stat.

export type ArtistPlayStat = { total: number; latest: number };

// Per-artist live aggregate over the whole catalog: summed play_count and the
// freshest work's time. Light columns, no cap — accurate beyond the feed slice.
export async function getArtistPlayStats(
  supabase: SupabaseServerClient,
): Promise<Map<string, ArtistPlayStat>> {
  const { data } = await supabase
    .from("work")
    .select("creator_id, play_count, created_at")
    .eq("status", "live")
    .eq("taken_down", false);

  const stats = new Map<string, ArtistPlayStat>();
  for (const r of (data ?? []) as Array<{
    creator_id: string | null;
    play_count: number | null;
    created_at: string;
  }>) {
    if (!r.creator_id) continue;
    const t = new Date(r.created_at).getTime();
    const cur = stats.get(r.creator_id);
    if (cur) {
      cur.total += r.play_count ?? 0;
      if (t > cur.latest) cur.latest = t;
    } else {
      stats.set(r.creator_id, { total: r.play_count ?? 0, latest: t });
    }
  }
  return stats;
}

// A single (album-less live work) carrying its maker's identity, so Browse can
// group singles by artist. The raw display_name is returned as-is; the caller
// applies the warm fallback (artistName) once, at grouping time.
export type SingleWithArtist = {
  work: FeedWork;
  creatorId: string;
  creatorName: string | null;
  creatorHandle: string | null;
};

// Every album-less live work across all artists, newest first, each with its
// creator (a profile, via the work.creator_id FK). Same live-only discipline as
// the feed; the creator embed rides along for the per-artist grouping.
export async function getSinglesWithArtist(
  supabase: SupabaseServerClient,
  limit = FEED_LIMIT,
): Promise<SingleWithArtist[]> {
  const { data } = await supabase
    .from("work")
    .select(`${WORK_SELECT}, creator_id, creator:creator_id(display_name, handle)`)
    .eq("status", "live")
    .eq("taken_down", false)
    .is("album_id", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (
    (data ?? []) as unknown as Array<
      WorkRow & {
        creator_id: string | null;
        creator: { display_name: string | null; handle: string | null } | null;
      }
    >
  )
    .filter((row) => !!row.creator_id)
    .map((row) => ({
      work: shape(row),
      creatorId: row.creator_id as string,
      creatorName: row.creator?.display_name ?? null,
      creatorHandle: row.creator?.handle ?? null,
    }));
}
