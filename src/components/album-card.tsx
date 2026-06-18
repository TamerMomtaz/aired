import Image from "next/image";
import Link from "next/link";

import type { AlbumCardData } from "@/lib/albums/public-queries";

// One album on the Listen shelf (and on an artist page): a cover that opens to
// its songs, the title, the artist (a separate link to /artist/[handle], falling
// back to the profile id), and the live-song count. The artist link is a sibling
// of the cover/title links — never nested — so there are no nested anchors
// (mirrors WorkCard's share-button rule).
export function AlbumCard({ album }: { album: AlbumCardData }) {
  const count = album.liveSongCount;
  return (
    <article className="group flex flex-col gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3 transition hover:border-white/15 hover:bg-white/[0.04]">
      <Link
        href={`/album/${album.id}`}
        className="relative block aspect-square overflow-hidden rounded-lg border border-white/8"
        aria-label={`Open album ${album.title}`}
      >
        {album.coverUrl ? (
          <Image
            src={album.coverUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
            className="object-cover transition group-hover:scale-[1.02]"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.04] to-transparent text-[10px] uppercase tracking-[0.18em] text-muted/50">
            no cover
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full border border-white/15 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted backdrop-blur">
          Album
        </span>
      </Link>

      <div className="flex flex-col gap-1.5">
        <Link
          href={`/album/${album.id}`}
          className="block h-10 overflow-hidden transition hover:opacity-90"
        >
          <span className="line-clamp-2 text-sm font-medium text-foreground">
            {album.title}
          </span>
        </Link>

        <Link
          href={`/artist/${album.artistHandle ?? album.artistId}`}
          className="block max-w-full truncate text-[13px] text-muted transition hover:text-foreground"
        >
          {album.artistName}
        </Link>

        <div className="flex h-4 items-center font-mono text-[11px] leading-4 text-muted/60">
          {count} {count === 1 ? "song" : "songs"}
        </div>
      </div>
    </article>
  );
}
