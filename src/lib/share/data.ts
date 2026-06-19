import { resolveAlbumCover } from "@/lib/albums/queries";
import {
  artistName,
  getAlbumMeta,
  resolveArtistHeader,
} from "@/lib/albums/public-queries";
import { formatCatalogId } from "@/lib/catalog";
import { createClient } from "@/lib/supabase/server";
import {
  dedupeContributors,
  getAlbumSongs,
  getWorkById,
} from "@/lib/works/queries";

import type { ShareCardData } from "./card";
import { SITE_ORIGIN } from "./props";

// Supabase-backed builders that turn a song / album / artist into the publicity
// card's data. Every read is live-only (a draft, an in-review, or a taken-down
// subject never resolves), so a card can never leak an unpublished work — the
// queries reused here all filter status='live' AND taken_down=false (CLAUDE.md
// §1.5, and the brief's "cards never show drafts/pending/taken-down"). The pure
// copy/URL helpers (share text, filenames) live in ./props.

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// One song → its card. Reuses getWorkById (live-only), so a draft / pending /
// taken-down work resolves to null and the route degrades to the fallback.
export async function buildSongCard(
  supabase: SupabaseServerClient,
  idParam: string,
): Promise<ShareCardData | null> {
  const workId = Number(idParam);
  if (!Number.isInteger(workId) || workId <= 0) return null;
  const work = await getWorkById(supabase, workId);
  if (!work) return null;

  return {
    kind: "song",
    eyebrow: formatCatalogId(work.id),
    title: work.title,
    quote: true,
    coverUrl: work.artwork_url,
    round: false,
    names: work.contributors.map((c) => c.name),
    namesLabel: "Credited, by name",
    byline: null,
    certified: work.red_line_certified,
    url: `${SITE_ORIGIN}/registry/${work.id}`,
  };
}

// One album → its card. Its cover follows the shared rule (explicit cover, else
// newest live member's artwork); its credits union the distinct makers across
// its live songs; the Red Line shows if any member is certified.
export async function buildAlbumCard(
  supabase: SupabaseServerClient,
  idParam: string,
): Promise<ShareCardData | null> {
  const [meta, songs] = await Promise.all([
    getAlbumMeta(supabase, idParam),
    getAlbumSongs(supabase, idParam),
  ]);
  if (!meta) return null;

  const newestArtwork =
    [...songs]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .find((s) => s.artwork_url)?.artwork_url ?? null;

  // Union the makers across the album's live songs, deduped by slug-or-name.
  const names = dedupeContributors(
    songs.flatMap((s) => s.contributors.map((agent) => ({ agent }))),
  ).map((c) => c.name);

  return {
    kind: "album",
    eyebrow: "Album",
    title: meta.title,
    quote: true,
    coverUrl: resolveAlbumCover(meta.coverUrlRaw, newestArtwork),
    round: false,
    names,
    namesLabel: "Credited, by name",
    byline: `by ${meta.artistName}`,
    certified: songs.some((s) => s.red_line_certified),
    url: `${SITE_ORIGIN}/album/${meta.id}`,
  };
}

type ArtistWorkRow = {
  red_line_certified: boolean;
  public_volley: Array<{
    agent: { name: string; profile_slug: string | null } | null;
  }>;
};

// One artist → their card. The hero is their name + handle; the credits line is
// the distinct collaborators across their live catalogue (carbon and silicon,
// by name); the Red Line shows if any of their works is certified.
export async function buildArtistCard(
  supabase: SupabaseServerClient,
  param: string,
): Promise<ShareCardData | null> {
  const header = await resolveArtistHeader(supabase, param);
  if (!header) return null;

  const { data } = await supabase
    .from("work")
    .select("red_line_certified, public_volley(agent(name, profile_slug))")
    .eq("creator_id", header.id)
    .eq("status", "live")
    .eq("taken_down", false)
    .limit(80);

  const works = (data ?? []) as unknown as ArtistWorkRow[];
  const names = dedupeContributors(works.flatMap((w) => w.public_volley)).map(
    (c) => c.name,
  );
  const certified = works.some((w) => w.red_line_certified);
  const display = artistName(header.displayName);

  return {
    kind: "artist",
    eyebrow: "Artist",
    title: display,
    quote: false,
    coverUrl: header.avatarUrl,
    round: true,
    initial: display.trim().charAt(0).toUpperCase() || "·",
    names,
    namesLabel: "Collaborators, by name",
    byline: header.handle ? `@${header.handle}` : null,
    certified,
    url: `${SITE_ORIGIN}/artist/${header.handle ?? header.id}`,
  };
}
