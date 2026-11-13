import Image from "next/image";
import Link from "next/link";

import { CardPlayButton } from "@/components/player/card-play-button";
import type { Track } from "@/components/player/track";
import { WorkTitle } from "@/components/work-title";
import { FRESH_COUNT, FRESH_VIDEOS } from "@/lib/fresh/videos";
import type { FeedWork } from "@/lib/works/queries";

// FRESH DROP: the newest songs on AIRED, front and centre on Listen, each with
// its cover brought to life as a looping video when one has been made. The
// newest live songs are picked here, so each new song pushes the oldest out.
export function FreshDrop({ works, queue }: { works: FeedWork[]; queue: Track[] }) {
  const fresh = [...works]
    .filter((w) => w.hls_playlist_key)
    .sort((a, b) => b.id - a.id)
    .slice(0, FRESH_COUNT);
  if (fresh.length === 0) return null;

  return (
    <section className="fresh-drop mb-9 flex flex-col gap-3" aria-labelledby="fresh-drop-title">
      <div className="flex items-center gap-2">
        <span className="fresh-dot" aria-hidden />
        <h2 id="fresh-drop-title" className="fresh-heading">
          Fresh drop
        </h2>
        <span className="text-xs text-muted">The newest on AIRED</span>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:gap-5">
        {fresh.map((work) => {
          const video = FRESH_VIDEOS[work.id];
          return (
            <li key={work.id} className="fresh-card">
              <div className="relative isolate">
                <Link
                  href={`/registry/${work.id}`}
                  className="fresh-frame relative block aspect-square overflow-hidden rounded-xl"
                  aria-label={`Open AIRED-${work.id} ${work.title}`}
                >
                  {video ? (
                    <video
                      src={video}
                      poster={work.artwork_url ?? undefined}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : work.artwork_url ? (
                    <Image src={work.artwork_url} alt="" fill sizes="(min-width: 640px) 45vw, 50vw" className="object-cover" unoptimized />
                  ) : null}
                  <span className="fresh-badge">New</span>
                </Link>
                {queue.length ? <CardPlayButton queue={queue} workId={work.id} title={work.title} /> : null}
              </div>
              <Link href={`/registry/${work.id}`} className="mt-2 block transition hover:opacity-90">
                <WorkTitle id={work.id} title={work.title} size="sm" />
              </Link>
              <p className="truncate text-xs text-muted">{work.contributors.map((c) => c.name).join(" · ")}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
