import { normalizeDescriptors } from "@/lib/ledger/descriptors";
import { createClient } from "@/lib/supabase/server";

// Read side of ORGANIZE: a creator's own albums and works, plus the cover
// derivation reused by browse-as-label next. Everything here is owner-scoped —
// the queries filter by the caller's id and RLS backs that up (album: public
// read; work: live-or-owner). Nothing here touches another creator's private data.

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type WorkStatus = "draft" | "live" | "pending";

// Cover derivation (read-side; reused by browse next). An album's cover is its
// explicit cover_url if one was set, else the artwork of its newest member work,
// else null — and a null tells the surface to render its own neutral placeholder
// (there is no placeholder asset; each surface draws a "no art" tile). Keep this
// the single source of truth so the cover an owner sees in /manage is the same
// one browse will show.
export function resolveAlbumCover(
  coverUrl: string | null,
  newestMemberArtworkUrl: string | null,
): string | null {
  return coverUrl ?? newestMemberArtworkUrl ?? null;
}

// The minimum an album picker needs (upload form, work re-filing select).
export type AlbumOption = { id: string; title: string };

// My albums, newest first, as lightweight options for a picker.
export async function getMyAlbumOptions(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<AlbumOption[]> {
  const { data } = await supabase
    .from("album")
    .select("id, title")
    .eq("profile_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as AlbumOption[];
}

// One artwork a member work offers as a candidate album cover.
export type AlbumCoverChoice = {
  workId: number;
  title: string;
  artworkUrl: string;
};

export type ManageAlbum = {
  id: string;
  title: string;
  description: string | null;
  // Derived cover (see resolveAlbumCover): explicit cover, else newest member's
  // artwork, else null.
  coverUrl: string | null;
  // Whether cover_url is explicitly set — lets the UI say "custom cover" vs.
  // "from newest song" and offer a revert.
  hasCustomCover: boolean;
  workCount: number;
  // Member works that carry artwork, newest first — the "Set cover" choices.
  coverChoices: AlbumCoverChoice[];
};

export type ManageWork = {
  id: number;
  title: string;
  status: WorkStatus;
  albumId: string | null;
  albumTitle: string | null;
  // Editable state, so Manage → Edit opens the in-place editor without a second
  // fetch. descriptors arrive normalized (split/trimmed/deduped) for the editor.
  descriptors: string[];
  lyrics: string | null;
  artworkUrl: string | null;
  // Discard confirm-level gating: a live work, or one with plays / a minted Red
  // Line, needs the stronger confirm.
  playCount: number;
  certified: boolean;
  // Admin governance: the owner still sees their own taken-down work here, with
  // the reason — they can edit or appeal it, but never re-publish it.
  takenDown: boolean;
  takedownReason: string | null;
};

type AlbumRow = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  created_at: string;
};

type WorkRow = {
  id: number;
  title: string;
  status: WorkStatus;
  album_id: string | null;
  artwork_url: string | null;
  created_at: string;
  descriptors: string[] | null;
  lyrics: string | null;
  play_count: number | null;
  red_line_certified: boolean | null;
  taken_down: boolean | null;
  takedown_reason: string | null;
};

// Everything the /manage surface needs in two owner-scoped reads: the caller's
// albums (with derived cover + work count + cover choices) and all their works
// (every status), each tagged with its current album. We aggregate per-album in
// code from the single works read so a member work is fetched once and reused for
// counts, cover choices, and the works list alike.
export async function getManageData(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<{ albums: ManageAlbum[]; works: ManageWork[] }> {
  const [albumsRes, worksRes] = await Promise.all([
    supabase
      .from("album")
      .select("id, title, description, cover_url, created_at")
      .eq("profile_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("work")
      .select(
        "id, title, status, album_id, artwork_url, created_at, descriptors, lyrics, play_count, red_line_certified, taken_down, takedown_reason",
      )
      .eq("creator_id", userId)
      .order("id", { ascending: false }),
  ]);

  const albumRows = (albumsRes.data ?? []) as AlbumRow[];
  const workRows = (worksRes.data ?? []) as WorkRow[];

  // Group works by album for counts + cover derivation.
  const membersByAlbum = new Map<string, WorkRow[]>();
  for (const w of workRows) {
    if (!w.album_id) continue;
    const arr = membersByAlbum.get(w.album_id);
    if (arr) arr.push(w);
    else membersByAlbum.set(w.album_id, [w]);
  }

  const albums: ManageAlbum[] = albumRows.map((a) => {
    const members = membersByAlbum.get(a.id) ?? [];
    // Newest-first by created_at for the cover fallback + choice order.
    const withArt = members
      .filter((m): m is WorkRow & { artwork_url: string } => !!m.artwork_url)
      .sort(
        (x, y) =>
          new Date(y.created_at).getTime() - new Date(x.created_at).getTime(),
      );
    const coverChoices: AlbumCoverChoice[] = withArt.map((m) => ({
      workId: m.id,
      title: m.title,
      artworkUrl: m.artwork_url,
    }));
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      coverUrl: resolveAlbumCover(a.cover_url, coverChoices[0]?.artworkUrl ?? null),
      hasCustomCover: !!a.cover_url,
      workCount: members.length,
      coverChoices,
    };
  });

  const titleById = new Map(albumRows.map((a) => [a.id, a.title]));
  const works: ManageWork[] = workRows.map((w) => ({
    id: w.id,
    title: w.title,
    status: w.status,
    albumId: w.album_id,
    albumTitle: w.album_id ? (titleById.get(w.album_id) ?? null) : null,
    descriptors: normalizeDescriptors(w.descriptors),
    lyrics: w.lyrics,
    artworkUrl: w.artwork_url,
    playCount: w.play_count ?? 0,
    certified: !!w.red_line_certified,
    takenDown: !!w.taken_down,
    takedownReason: w.takedown_reason,
  }));

  return { albums, works };
}
