import { createClient } from "@/lib/supabase/server";
import { dedupeContributors, type FeedWork } from "@/lib/works/queries";

// The listener's own shelf: what they ADORNED, and the MOODS they built.
//
// Everything here is private by construction — the adornment / mood / mood_item
// policies return only the caller's own rows, so these queries carry no
// "where profile_id = me" of their own to forget. They still filter to LIVE,
// non-taken-down works: a song can be adorned today and pulled tomorrow, and a
// shelf must never offer a row that cannot play.
//
// Every read here FAILS SOFT (returns empty rather than throwing). These run in
// the root layout and on the listener's own pages; a library that isn't reachable
// for a moment should quietly show nothing, never take the whole site down with
// it. supabase-js reports errors in-band, so this costs one `if`.

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Same column set the feed cards are built from, so an adorned song and a
// browsed song render identically. Kept in step with works/queries.ts:WORK_SELECT.
const WORK_SELECT =
  "id, title, artwork_url, duration_seconds, red_line_certified, created_at, hls_playlist_key, album_id, play_count, clip_start_seconds, clip_length_seconds, public_volley(agent(name, profile_slug))";

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

// ── Adorned ────────────────────────────────────────────────────────────────

// Just the ids, for painting the ankh. This runs in the root layout on every page,
// so it stays deliberately tiny: one indexed column, no joins, no work rows.
// Signed out ⇒ [] without a round trip.
export async function getAdornedWorkIds(
  supabase: SupabaseServerClient,
  userId: string | null,
): Promise<number[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("adornment")
    .select("work_id")
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as { work_id: number }[]).map((r) => r.work_id);
}

// The Adorned shelf itself: what the listener kept, newest first, card-ready.
// Two steps rather than one embed — the order that matters is the ADORNMENT's
// created_at (when you kept it), not the work's (when it was made), and that
// ordering can't be expressed through a nested embed.
export async function getAdornedWorks(
  supabase: SupabaseServerClient,
  userId: string | null,
): Promise<FeedWork[]> {
  const ids = await getAdornedWorkIds(supabase, userId);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("work")
    .select(WORK_SELECT)
    .in("id", ids)
    .eq("status", "live")
    .eq("taken_down", false);
  if (error) return [];

  const byId = new Map<number, FeedWork>();
  for (const row of (data ?? []) as unknown as WorkRow[]) {
    byId.set(row.id, shape(row));
  }
  // Re-impose the adorned order the ids arrived in; a song that has since been
  // pulled simply drops out.
  return ids
    .map((id) => byId.get(id))
    .filter((w): w is FeedWork => w !== undefined);
}

// ── Moods ──────────────────────────────────────────────────────────────────

export type MoodSummary = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  // How many songs are in it, for the shelf's one-line subtitle.
  songCount: number;
  // The first few covers, so a mood reads as a stack of art rather than a word.
  coverUrls: string[];
};

// Every mood the listener owns, newest first, each with its song count and a
// few covers. One query for the moods, one for their items — not N+1.
export async function getMyMoods(
  supabase: SupabaseServerClient,
  userId: string | null,
): Promise<MoodSummary[]> {
  if (!userId) return [];
  const { data, error } = await supabase
    .from("mood")
    .select("id, name, description, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (error) return [];

  const moods = (data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  }>;
  if (moods.length === 0) return [];

  // Covers + counts for every mood at once. Ordered by position so the covers
  // shown are the ones at the top of each mood.
  const { data: itemData } = await supabase
    .from("mood_item")
    .select("mood_id, position, work:work_id(artwork_url, status, taken_down)")
    .in(
      "mood_id",
      moods.map((m) => m.id),
    )
    .order("position", { ascending: true });

  const covers = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const row of (itemData ?? []) as unknown as Array<{
    mood_id: string;
    work: {
      artwork_url: string | null;
      status: string;
      taken_down: boolean;
    } | null;
  }>) {
    // A pulled song stops counting toward the mood the listener sees.
    if (!row.work || row.work.status !== "live" || row.work.taken_down) continue;
    counts.set(row.mood_id, (counts.get(row.mood_id) ?? 0) + 1);
    const list = covers.get(row.mood_id) ?? [];
    if (list.length < 4 && row.work.artwork_url) {
      list.push(row.work.artwork_url);
      covers.set(row.mood_id, list);
    }
  }

  return moods.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
    songCount: counts.get(m.id) ?? 0,
    coverUrls: covers.get(m.id) ?? [],
  }));
}

export type MoodDetail = {
  id: string;
  name: string;
  description: string | null;
  // The songs in the listener's order. `itemId` is the mood_item row — what the
  // reorder / remove actions address, so a work can't be confused for its place
  // in the run.
  songs: Array<{ itemId: string; work: FeedWork }>;
};

// One mood, with its songs in position order. Returns null when the mood isn't
// the caller's — RLS returns no row, and we don't distinguish "not yours" from
// "not there": the page 404s either way, which is the honest answer to someone
// guessing at another listener's URL.
export async function getMoodDetail(
  supabase: SupabaseServerClient,
  moodId: string,
): Promise<MoodDetail | null> {
  const { data: mood, error } = await supabase
    .from("mood")
    .select("id, name, description")
    .eq("id", moodId)
    .maybeSingle();
  if (error || !mood) return null;

  // status + taken_down ride along so a song pulled AFTER it joined the mood
  // drops out here too. mood_add_work refuses a non-live work at the door, but
  // nothing stops a work being taken down later — and the shelf's count already
  // excludes those, so without this the count and the list would disagree.
  const { data: items } = await supabase
    .from("mood_item")
    .select(`id, position, work:work_id(${WORK_SELECT}, status, taken_down)`)
    .eq("mood_id", moodId)
    .order("position", { ascending: true })
    .order("added_at", { ascending: true });

  const songs: MoodDetail["songs"] = [];
  for (const row of (items ?? []) as unknown as Array<{
    id: string;
    work: (WorkRow & { status: string; taken_down: boolean }) | null;
  }>) {
    if (!row.work || row.work.status !== "live" || row.work.taken_down) continue;
    songs.push({ itemId: row.id, work: shape(row.work) });
  }

  const m = mood as { id: string; name: string; description: string | null };
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    songs,
  };
}
