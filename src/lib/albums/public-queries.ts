import { resolveAlbumCover } from "@/lib/albums/queries";
import { createClient } from "@/lib/supabase/server";

// Public, anon-safe reads for BROWSE-AS-LABEL: the album shelf on Listen, the
// album page, and the artist page. These differ from the ORGANIZE reads
// (src/lib/albums/queries.ts) in scope — they are NOT owner-scoped; they serve
// the whole label to everyone. The cover rule and the live-only discipline are
// shared, though: covers go through resolveAlbumCover, and every count/list is
// derived from status='live' rows ONLY (filtered explicitly, never trusting RLS
// — an admin or owner can read non-live, but these public surfaces must not).

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// A profile's display_name is nullable; this is the warm, neutral fallback so a
// nameless artist still reads as a person and stays linkable. Centralized so the
// album card, album header, and artist header all agree.
export const ARTIST_FALLBACK_NAME = "AIRED artist";
export function artistName(displayName: string | null | undefined): string {
  const n = (displayName ?? "").trim();
  return n.length > 0 ? n : ARTIST_FALLBACK_NAME;
}

// A pretty UUID guard so a malformed /album/<x> or /artist/<x> 404s cleanly
// instead of tripping a Postgres 22P02 on the uuid column.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// A label-shelf album card: derived cover, title, its artist (a profile), and how
// many LIVE songs it holds. Only albums with ≥1 live song ever become a card.
export type AlbumCardData = {
  id: string;
  title: string;
  coverUrl: string | null;
  // The artist = the album's owning profile. id drives /artist/[id] (handles are
  // null for now); name is the display_name (with fallback).
  artistId: string;
  artistName: string;
  liveSongCount: number;
};

// Header metadata for an album page (the songs come from getAlbumSongs).
export type AlbumMeta = {
  id: string;
  title: string;
  description: string | null;
  // The album's explicit cover_url BEFORE derivation; the page feeds it through
  // resolveAlbumCover with the newest live member's artwork.
  coverUrlRaw: string | null;
  artistId: string;
  artistName: string;
};

// Header metadata for an artist page (their albums + singles come separately).
export type ArtistHeader = {
  id: string;
  displayName: string;
  mascotName: string | null;
  bio: string | null;
  avatarUrl: string | null;
};

// A flat live-member row (light columns) used only for per-album aggregation.
type MemberRow = {
  album_id: string | null;
  artwork_url: string | null;
  created_at: string;
};

// Per-album live aggregate: count, the cover candidate (newest live member that
// carries artwork), and the latest member time (the album sort key). This is the
// LIVE-scoped twin of the manage-side derivation in src/lib/albums/queries.ts.
type AlbumAgg = { count: number; coverArtwork: string | null; latest: number };

function aggregateLiveMembers(rows: MemberRow[]): Map<string, AlbumAgg> {
  // Newest-first so the first artwork kept per album is the newest one — matching
  // the cover rule: cover = cover_url ?? newest LIVE member artwork ?? placeholder.
  const sorted = [...rows].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  const byAlbum = new Map<string, AlbumAgg>();
  for (const r of sorted) {
    if (!r.album_id) continue;
    const t = new Date(r.created_at).getTime();
    const agg = byAlbum.get(r.album_id);
    if (agg) {
      agg.count += 1;
      if (!agg.coverArtwork && r.artwork_url) agg.coverArtwork = r.artwork_url;
      if (t > agg.latest) agg.latest = t;
    } else {
      byAlbum.set(r.album_id, {
        count: 1,
        coverArtwork: r.artwork_url ?? null,
        latest: t,
      });
    }
  }
  return byAlbum;
}

type AlbumMetaRow = {
  id: string;
  title: string;
  cover_url: string | null;
  profile_id: string;
  // PostgREST returns this FK embed as a single object (many-to-one).
  profile: { display_name: string | null } | null;
};

// Build album cards from album rows + their live-member aggregate, dropping any
// album with zero live songs and ordering by freshest live song first.
function buildAlbumCards(
  albums: AlbumMetaRow[],
  agg: Map<string, AlbumAgg>,
): AlbumCardData[] {
  const ranked: Array<{ card: AlbumCardData; latest: number }> = [];
  for (const a of albums) {
    const ag = agg.get(a.id);
    if (!ag || ag.count === 0) continue;
    ranked.push({
      latest: ag.latest,
      card: {
        id: a.id,
        title: a.title,
        coverUrl: resolveAlbumCover(a.cover_url, ag.coverArtwork),
        artistId: a.profile_id,
        artistName: artistName(a.profile?.display_name ?? null),
        liveSongCount: ag.count,
      },
    });
  }
  // Freshest album first (by its newest live song).
  ranked.sort((x, y) => y.latest - x.latest);
  return ranked.map((r) => r.card);
}

// The Listen album shelf: every album that holds ≥1 live song, across all
// artists, freshest first. Two reads — the live members (light), then the album
// rows for the albums those members belong to (with the artist's name).
export async function getBrowseAlbums(
  supabase: SupabaseServerClient,
): Promise<AlbumCardData[]> {
  const { data: memberData } = await supabase
    .from("work")
    .select("album_id, artwork_url, created_at")
    .eq("status", "live")
    .not("album_id", "is", null);

  const agg = aggregateLiveMembers((memberData ?? []) as MemberRow[]);
  if (agg.size === 0) return [];

  const { data: albumData } = await supabase
    .from("album")
    .select("id, title, cover_url, profile_id, profile:profile_id(display_name)")
    .in("id", Array.from(agg.keys()));

  return buildAlbumCards((albumData ?? []) as unknown as AlbumMetaRow[], agg);
}

// One artist's album shelf for their page: their albums that hold ≥1 live song.
// The artist's name is the same for every card, so the caller passes it in
// (already resolved) rather than re-embedding the profile per album.
export async function getArtistAlbums(
  supabase: SupabaseServerClient,
  profileId: string,
  displayName: string,
): Promise<AlbumCardData[]> {
  const { data: albumData } = await supabase
    .from("album")
    .select("id, title, cover_url")
    .eq("profile_id", profileId);
  const albums = (albumData ?? []) as Array<{
    id: string;
    title: string;
    cover_url: string | null;
  }>;
  if (albums.length === 0) return [];

  const { data: memberData } = await supabase
    .from("work")
    .select("album_id, artwork_url, created_at")
    .eq("status", "live")
    .in(
      "album_id",
      albums.map((a) => a.id),
    );
  const agg = aggregateLiveMembers((memberData ?? []) as MemberRow[]);

  // Reuse the card builder by shaping these rows like AlbumMetaRow (the artist is
  // fixed, so profile_id/name are this artist's).
  const name = artistName(displayName);
  const metaRows: AlbumMetaRow[] = albums.map((a) => ({
    id: a.id,
    title: a.title,
    cover_url: a.cover_url,
    profile_id: profileId,
    profile: { display_name: name },
  }));
  return buildAlbumCards(metaRows, agg);
}

// Album page header. Returns null for a malformed id or a missing album (→ 404).
export async function getAlbumMeta(
  supabase: SupabaseServerClient,
  albumId: string,
): Promise<AlbumMeta | null> {
  if (!isUuid(albumId)) return null;
  const { data } = await supabase
    .from("album")
    .select(
      "id, title, description, cover_url, profile_id, profile:profile_id(display_name)",
    )
    .eq("id", albumId)
    .maybeSingle();
  if (!data) return null;
  const a = data as unknown as AlbumMetaRow & { description: string | null };
  return {
    id: a.id,
    title: a.title,
    description: a.description ?? null,
    coverUrlRaw: a.cover_url,
    artistId: a.profile_id,
    artistName: artistName(a.profile?.display_name ?? null),
  };
}

// Artist page header (the artist IS a profile — one account = one artist, v1).
// Returns null for a malformed id or a missing profile (→ 404). profile is
// public-read by RLS, so anon gets the name/mascot/bio/avatar.
export async function getArtistHeader(
  supabase: SupabaseServerClient,
  profileId: string,
): Promise<ArtistHeader | null> {
  if (!isUuid(profileId)) return null;
  const { data } = await supabase
    .from("profile")
    .select("id, display_name, mascot_name, bio, avatar_url")
    .eq("id", profileId)
    .maybeSingle();
  if (!data) return null;
  const p = data as {
    id: string;
    display_name: string | null;
    mascot_name: string | null;
    bio: string | null;
    avatar_url: string | null;
  };
  return {
    id: p.id,
    displayName: artistName(p.display_name),
    mascotName: p.mascot_name?.trim() || null,
    bio: p.bio?.trim() || null,
    avatarUrl: p.avatar_url ?? null,
  };
}
