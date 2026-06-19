import Image from "next/image";
import { notFound, redirect } from "next/navigation";

import { AlbumCard } from "@/components/album-card";
import { trackFromFeedWork } from "@/components/player/track";
import { ShareSheet } from "@/components/share-sheet";
import { WorkCard } from "@/components/work-card";
import {
  getArtistAlbums,
  isUuid,
  resolveArtistHeader,
} from "@/lib/albums/public-queries";
import { artistShareProps } from "@/lib/share/props";
import { createClient } from "@/lib/supabase/server";
import { dedupeContributors, getArtistSingles } from "@/lib/works/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const supabase = await createClient();
  const header = await resolveArtistHeader(supabase, handle);
  if (!header) return { title: "Artist · AIRED" };
  const title = `${header.displayName} · AIRED`;
  const description =
    header.bio ??
    `${header.displayName} on AIRED — albums and singles, credited by name, carbon and silicon alike.`;
  const canonical = `/artist/${header.handle ?? header.id}`;
  // The colocated opengraph-image supplies the publicity card; these hints make
  // the unfurl a large-image card and give it a canonical URL + site name.
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "profile",
      title,
      description,
      url: canonical,
      siteName: "AIRED",
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

// A public artist page (the artist IS a profile — one account = one artist, v1).
// Addressed canonically by HANDLE (/artist/[handle]); a legacy id-shaped URL
// (/artist/<uuid>) still resolves, and redirects to the handle when the artist
// has one. Header (name, mascot, bio, avatar) + their ALBUMS (≥1 live song) +
// their SINGLES (album-less live works). Live content only: the owner's
// drafts/pending and any taken-down work never show here (getArtistSingles /
// getArtistAlbums filter status='live' AND taken_down=false explicitly).
export default async function ArtistPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: param } = await params;
  const supabase = await createClient();

  const header = await resolveArtistHeader(supabase, param);
  if (!header) notFound();
  // Canonicalize: an id-shaped URL for an artist who has a handle redirects to
  // the pretty /artist/[handle] form. Id-only artists (no handle yet) render here.
  if (isUuid(param) && header.handle) redirect(`/artist/${header.handle}`);

  const [albums, singles] = await Promise.all([
    getArtistAlbums(supabase, header.id, header.displayName, header.handle),
    getArtistSingles(supabase, header.id),
  ]);

  // Singles queue: this artist's album-less live works, catalog order.
  const queue = singles
    .map(trackFromFeedWork)
    .filter((t) => t.hlsPlaylistKey)
    .sort((a, b) => a.id - b.id);

  const hasContent = albums.length > 0 || singles.length > 0;
  const initial = header.displayName.trim().charAt(0).toUpperCase() || "·";

  // Collaborators surfaced from this artist's singles (carbon and silicon, by
  // name) — names the share copy. The publicity card computes the full set
  // across their whole live catalogue server-side.
  const collaborators = dedupeContributors(
    singles.flatMap((s) => s.contributors.map((agent) => ({ agent }))),
  ).map((c) => c.name);
  const shareId = header.handle ?? header.id;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start">
        {header.avatarUrl ? (
          <Image
            src={header.avatarUrl}
            alt=""
            width={96}
            height={96}
            className="size-20 shrink-0 rounded-full border border-white/10 object-cover sm:size-24"
            unoptimized
          />
        ) : (
          <div className="flex size-20 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-2xl font-semibold text-muted sm:size-24">
            {initial}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.18em] text-muted/60">
            Artist
          </span>
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            {header.displayName}
          </h1>
          {header.handle ? (
            <p className="font-mono text-xs text-muted/60">@{header.handle}</p>
          ) : null}
          {header.mascotName ? (
            <p className="text-sm text-muted">
              AI voices as{" "}
              <span className="text-foreground">{header.mascotName}</span>
            </p>
          ) : null}
          {header.bio ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              {header.bio}
            </p>
          ) : null}
          <div className="mt-1">
            <ShareSheet
              {...artistShareProps(
                shareId,
                header.displayName,
                header.handle,
                collaborators,
              )}
            />
          </div>
        </div>
      </header>

      {hasContent ? (
        <div className="flex flex-col gap-10">
          {albums.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
                Albums
              </h2>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {albums.map((album) => (
                  <li key={album.id}>
                    <AlbumCard album={album} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {singles.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
                Singles
              </h2>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {singles.map((work) => (
                  <li key={work.id}>
                    <WorkCard work={work} queue={queue} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-white/12 px-5 py-12 text-center text-sm text-muted">
          No public works yet.
        </p>
      )}
    </main>
  );
}
