import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { trackFromFeedWork } from "@/components/player/track";
import { WorkCard } from "@/components/work-card";
import { getAlbumMeta } from "@/lib/albums/public-queries";
import { resolveAlbumCover } from "@/lib/albums/queries";
import { createClient } from "@/lib/supabase/server";
import { getAlbumSongs } from "@/lib/works/queries";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const meta = await getAlbumMeta(supabase, id);
  if (!meta) return { title: "Album · AIRED" };
  return {
    title: `${meta.title} · ${meta.artistName} · AIRED`,
    description: `${meta.title} by ${meta.artistName} — an album on AIRED. Made by carbon and silicon, credited by name.`,
  };
}

// A public album: the cover that opens to its songs. Header (cover, title, artist
// link, description, live-song count) + the LIVE songs as the usual work cards.
// Songs are status='live' ONLY — filtered in getAlbumSongs, not left to RLS — so
// a draft / in-review work filed in this album never appears, not even to the
// owner or an admin. Organizing non-live works stays in /manage.
export default async function AlbumPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [meta, songs] = await Promise.all([
    getAlbumMeta(supabase, id),
    getAlbumSongs(supabase, id),
  ]);
  if (!meta) notFound();

  // Cover via the shared rule: explicit cover_url, else the newest LIVE member's
  // artwork, else a neutral placeholder. The songs are already live-only.
  const newestArtwork =
    [...songs]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .find((s) => s.artwork_url)?.artwork_url ?? null;
  const coverUrl = resolveAlbumCover(meta.coverUrlRaw, newestArtwork);

  // The album as a queue: its live songs in catalog (track) order, so pressing
  // play on any song plays the album through.
  const queue = songs
    .map(trackFromFeedWork)
    .filter((t) => t.hlsPlaylistKey)
    .sort((a, b) => a.id - b.id);

  const count = songs.length;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-start">
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={`Cover for ${meta.title}`}
            width={176}
            height={176}
            className="size-40 shrink-0 rounded-xl border border-white/10 object-cover sm:size-44"
            unoptimized
          />
        ) : (
          <div className="flex size-40 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/12 text-[10px] uppercase tracking-[0.16em] text-muted/50 sm:size-44">
            no cover
          </div>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-[0.18em] text-muted/60">
            Album
          </span>
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            {meta.title}
          </h1>
          <Link
            href={`/artist/${meta.artistId}`}
            className="self-start text-sm text-muted transition hover:text-foreground"
          >
            {meta.artistName}
          </Link>
          <span className="font-mono text-[11px] text-muted/60">
            {count} {count === 1 ? "song" : "songs"}
          </span>
          {meta.description ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              {meta.description}
            </p>
          ) : null}
        </div>
      </header>

      {count > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {songs.map((work) => (
            <li key={work.id}>
              <WorkCard work={work} queue={queue} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-white/12 px-5 py-12 text-center text-sm text-muted">
          No live songs in this album yet.
        </p>
      )}
    </main>
  );
}
