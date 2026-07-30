import { normalizeDescriptors } from "@/lib/ledger/descriptors";
import { createClient } from "@/lib/supabase/server";
import { manageableWorkFilter } from "@/lib/works/authority";
import { artistName } from "./public-queries";

// Read side of ORGANIZE: a creator's own albums and works, plus the cover
// derivation reused by browse-as-label next. Everything here is owner-scoped —
// the queries filter by the caller's id and RLS backs that up (album: public
// read; work: live-or-owner-or-carrier). Nothing here touches another creator's
// private data.
//
// "Owned" now has two shapes, because a delegated work files under the credited
// performer, not the human who carried it:
//   • works on MY rail        — creator_id = me (everything I uploaded myself);
//   • works I CARRIED         — published_by_authority = me, creator_id = a
//                               performer. They live on the performer's rail and
//                               in the performer's albums, but I am the human
//                               accountable for them, so they must be reachable
//                               here: an AI performer never signs in, and if the
//                               hands could not see the draft they landed, no
//                               human could ever promote it.

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type WorkStatus = "draft" | "live" | "pending";

// How a work reached AIRED (the honest wheelbarrow): by hands at the web UI, or
// by a program posting on a human's delegated authority. Never autonomy — a
// delegated upload always names the human whose token authorized it.
export type PublishedVia = "human_ui" | "delegated_api";

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
  // The share-video teaser window (PART A): which slice becomes this song's
  // Reels / TikTok clip. durationSeconds is the ceiling shown next to the control
  // so the owner knows where the song ends; null until the work is transcoded.
  durationSeconds: number | null;
  clipStartSeconds: number | null;
  clipLengthSeconds: number | null;
  // Discard confirm-level gating: a live work, or one with plays / a minted Red
  // Line, needs the stronger confirm.
  playCount: number;
  certified: boolean;
  // Admin governance: the owner still sees their own taken-down work here, with
  // the reason — they can edit or appeal it, but never re-publish it.
  takenDown: boolean;
  takedownReason: string | null;
  // Provenance of arrival, shown plainly on every work. `human_ui` carries no
  // authority or token (the session user was the uploader); `delegated_api`
  // always names the human who authorized it and the token label used.
  publishedVia: PublishedVia;
  authorityName: string | null;
  ingestTokenLabel: string | null;
  // Reciprocal provenance, the other half: WHOSE RAIL this work sits on.
  // `mine` is false for a work I merely carried for a performer — it belongs to
  // their catalog and their albums, and the surface must not offer to file it
  // into mine (enforce_album_ownership would refuse, rightly).
  mine: boolean;
  performerName: string;
  performerHandle: string | null;
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
  creator_id: string;
  album_id: string | null;
  artwork_url: string | null;
  created_at: string;
  descriptors: string[] | null;
  lyrics: string | null;
  duration_seconds: number | null;
  clip_start_seconds: number | null;
  clip_length_seconds: number | null;
  play_count: number | null;
  red_line_certified: boolean | null;
  taken_down: boolean | null;
  takedown_reason: string | null;
  published_via: PublishedVia | null;
  ingest_token_label: string | null;
  // The delegating human, embedded through the published_by_authority FK. Null
  // for every hand upload.
  authority: { display_name: string | null } | null;
  // The artist whose rail this work is on, embedded through the creator_id FK.
  // For my own uploads that is me; for a work I carried it is the performer.
  performer: { display_name: string | null; handle: string | null } | null;
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
        "id, title, status, creator_id, album_id, artwork_url, created_at, descriptors, lyrics, duration_seconds, clip_start_seconds, clip_length_seconds, play_count, red_line_certified, taken_down, takedown_reason, published_via, ingest_token_label, authority:published_by_authority(display_name), performer:creator_id(display_name, handle)",
      )
      .or(manageableWorkFilter(userId))
      .order("id", { ascending: false }),
  ]);

  const albumRows = (albumsRes.data ?? []) as AlbumRow[];
  const workRows = (worksRes.data ?? []) as unknown as WorkRow[];

  // Group MY OWN works by album for counts + cover derivation. A carried work
  // sits in the performer's album (enforce_album_ownership guarantees album and
  // work share an artist), so it can never be a member of one of my albums —
  // filtering here keeps that explicit rather than implied.
  const membersByAlbum = new Map<string, WorkRow[]>();
  for (const w of workRows) {
    if (!w.album_id || w.creator_id !== userId) continue;
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

  // A carried work's album belongs to the performer, so its title isn't in my
  // album list. Name it anyway — a work filed under "Album" that reads as an
  // untitled blank is worse than one extra read (album is public-read by RLS).
  const foreignAlbumIds = Array.from(
    new Set(
      workRows
        .filter((w) => w.album_id && !titleById.has(w.album_id))
        .map((w) => w.album_id as string),
    ),
  );
  if (foreignAlbumIds.length > 0) {
    const { data: foreign } = await supabase
      .from("album")
      .select("id, title")
      .in("id", foreignAlbumIds);
    for (const a of (foreign ?? []) as Array<{ id: string; title: string }>) {
      titleById.set(a.id, a.title);
    }
  }

  const works: ManageWork[] = workRows.map((w) => ({
    id: w.id,
    title: w.title,
    status: w.status,
    albumId: w.album_id,
    albumTitle: w.album_id ? (titleById.get(w.album_id) ?? null) : null,
    descriptors: normalizeDescriptors(w.descriptors),
    lyrics: w.lyrics,
    artworkUrl: w.artwork_url,
    durationSeconds: w.duration_seconds,
    clipStartSeconds: w.clip_start_seconds,
    clipLengthSeconds: w.clip_length_seconds,
    playCount: w.play_count ?? 0,
    certified: !!w.red_line_certified,
    takenDown: !!w.taken_down,
    takedownReason: w.takedown_reason,
    // Rows written before the column existed are hand uploads by definition, so
    // a NULL reads as 'human_ui' — the same default the DB now applies.
    publishedVia: w.published_via ?? "human_ui",
    // Only a delegated upload has an authority to name; the warm fallback keeps
    // a nameless-but-real artist readable rather than blank.
    authorityName: w.authority ? artistName(w.authority.display_name) : null,
    ingestTokenLabel: w.ingest_token_label,
    mine: w.creator_id === userId,
    performerName: artistName(w.performer?.display_name ?? null),
    performerHandle: w.performer?.handle?.trim() || null,
  }));

  return { albums, works };
}
