import { createClient } from "@/lib/supabase/server";
import { dedupeContributors } from "@/lib/works/queries";

// Read side of the Review queue (admin-only surface). A 'pending' work is one a
// non-trusted creator has submitted; it is hidden from the public by RLS and
// surfaced to an admin only — the `work_admin_read` policy is what lets these
// reads see across ownership. These helpers run on the session-bound client, so
// a non-admin calling them simply gets nothing (RLS returns only their own
// works, none of which the queue selects unless they happen to be the author).

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Everything a review card needs: the work, who uploaded it, the contributors it
// credits (by name — CLAUDE.md §3a), the full lyrics, and the HLS key to build
// the same stream URL the main player uses.
export type ReviewWork = {
  id: number;
  title: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  hlsPlaylistKey: string | null;
  lyrics: string | null;
  createdAt: string;
  creatorId: string;
  uploaderName: string;
  contributors: { name: string; profile_slug: string | null }[];
};

type ReviewRow = {
  id: number;
  title: string;
  artwork_url: string | null;
  duration_seconds: number | null;
  hls_playlist_key: string | null;
  lyrics: string | null;
  created_at: string;
  creator_id: string;
  uploader: { display_name: string | null; handle: string | null } | null;
  public_volley: Array<{
    agent: { name: string; profile_slug: string | null } | null;
  }>;
};

// `uploader:creator_id(...)` embeds the author's profile via the
// work_creator_id_fkey FK (the column hint disambiguates it from album_id).
const REVIEW_SELECT =
  "id, title, artwork_url, duration_seconds, hls_playlist_key, lyrics, created_at, creator_id, uploader:creator_id(display_name, handle), public_volley(agent:agent_id(name, profile_slug))";

function shape(row: ReviewRow): ReviewWork {
  const uploaderName =
    row.uploader?.display_name?.trim() ||
    row.uploader?.handle?.trim() ||
    "A creator";
  return {
    id: row.id,
    title: row.title,
    artworkUrl: row.artwork_url,
    durationSeconds: row.duration_seconds,
    hlsPlaylistKey: row.hls_playlist_key,
    lyrics: row.lyrics,
    createdAt: row.created_at,
    creatorId: row.creator_id,
    uploaderName,
    contributors: dedupeContributors(row.public_volley),
  };
}

// The queue itself: every 'pending' work, oldest first (first in, first reviewed).
export async function getPendingReviewWorks(
  supabase: SupabaseServerClient,
): Promise<ReviewWork[]> {
  const { data } = await supabase
    .from("work")
    .select(REVIEW_SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return ((data ?? []) as unknown as ReviewRow[]).map(shape);
}

// How many works are waiting — for the admin-only "Review" nav badge. Uses a
// head+count query so it never ships rows. A non-admin gets 0 (RLS hides others'
// pending works), which keeps the badge absent for everyone but admins anyway.
export async function getPendingReviewCount(
  supabase: SupabaseServerClient,
): Promise<number> {
  const { count } = await supabase
    .from("work")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}
