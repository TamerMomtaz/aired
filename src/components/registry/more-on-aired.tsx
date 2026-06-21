import Link from "next/link";

import type { Track } from "@/components/player/track";
import { WorkCard } from "@/components/work-card";
import type { FeedWork } from "@/lib/works/queries";

// ONE CLEAR NEXT STEP after a share-arrival presses play (combat single-song
// bounce): a short, swipeable strip of OTHER live songs — tap any to play, and it
// starts the catalog rolling from there — plus a single quiet path deeper (the
// album this song sits in, else its artist). Not a wall of options; one obvious
// way to keep listening, so a shared link doesn't dead-end.
//
// Live-only by construction: `works` come from the public feed (live + not
// taken-down), so drafts / pending / taken-down works never surface here.
export function MoreOnAired({
  works,
  queue,
  deeper,
}: {
  works: FeedWork[];
  // The whole catalog as a player queue, so tapping a tile plays "from here" on.
  queue: Track[];
  // The one quiet link below the strip — the album, or failing that the artist.
  deeper: { href: string; label: string } | null;
}) {
  if (works.length === 0 && !deeper) return null;

  return (
    <section className="mb-8 flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
        More on AIRED
      </h2>

      {works.length > 0 ? (
        <ul className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
          {works.map((work) => (
            <li key={work.id} className="w-40 shrink-0 snap-start">
              <WorkCard work={work} queue={queue} />
            </li>
          ))}
        </ul>
      ) : null}

      {deeper ? (
        <Link
          href={deeper.href}
          className="self-start text-sm text-muted underline-offset-4 transition hover:text-foreground hover:underline"
        >
          {deeper.label} →
        </Link>
      ) : null}
    </section>
  );
}
