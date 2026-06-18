import Image from "next/image";
import { notFound } from "next/navigation";

import { AlbumCard } from "@/components/album-card";
import { trackFromFeedWork } from "@/components/player/track";
import { WorkCard } from "@/components/work-card";
import {
  getArtistAlbums,
  getArtistHeader,
} from "@/lib/albums/public-queries";
import { createClient } from "@/lib/supabase/server";
import { getArtistSingles } from "@/lib/works/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const header = await getArtistHeader(supabase, id);
  if (!header) return { title: "Artist · AIRED" };
  return {
    title: `${header.displayName} · AIRED`,
    description:
      header.bio ??
      `${header.displayName} on AIRED — albums and singles, credited by name, carbon and silicon alike.`,
  };
}

// A public artist page (the artist IS a profile — one account = one artist, v1;
// keyed by profile id since handles arrive later with the newcomer journey).
// Header (name, mascot, bio, avatar) + their ALBUMS (≥1 live song) + their
// SINGLES (album-less live works). Live content only: albums with no live song
// are hidden, and the owner's drafts/pending never show here (getArtistSingles /
// getArtistAlbums filter status='live' explicitly — never trusting RLS, which
// would hand non-live rows to the owner or an admin).
export default async function ArtistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const header = await getArtistHeader(supabase, id);
  if (!header) notFound();

  const [albums, singles] = await Promise.all([
    getArtistAlbums(supabase, id, header.displayName),
    getArtistSingles(supabase, id),
  ]);

  // Singles queue: this artist's album-less live works, catalog order.
  const queue = singles
    .map(trackFromFeedWork)
    .filter((t) => t.hlsPlaylistKey)
    .sort((a, b) => a.id - b.id);

  const hasContent = albums.length > 0 || singles.length > 0;
  const initial = header.displayName.trim().charAt(0).toUpperCase() || "·";

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
