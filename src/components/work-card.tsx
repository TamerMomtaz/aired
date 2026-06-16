import Image from "next/image";
import Link from "next/link";

import { CardPlayButton } from "@/components/player/card-play-button";
import type { Track } from "@/components/player/track";
import { ShareButton } from "@/components/share-button";
import { WorkTitle } from "@/components/work-title";
import { formatDuration } from "@/lib/format";
import type { FeedWork } from "@/lib/works/queries";

// Cap visible contributor chips so a 2-contributor card and a 7-contributor
// card render at the same height — extras fold into a single "+N" indicator.
const MAX_VISIBLE_CHIPS = 3;

// One tile on the listener's Browse feed: cover, AIRED-#### · title, the
// contributors as followable chips (each linking to /agent/[slug]), a Red Line
// badge when certified, and the duration. Title, chip, and duration rows are
// fixed-height so every card in the grid renders identically regardless of
// how many contributors a work carries; any contributors past the cap fold
// into a compact "+N" chip. Chips stay outside the outer link (no nested
// anchors). Dedupe of repeated contributors is handled at the data layer
// (see src/lib/works/queries.ts:shape).
export function WorkCard({
  work,
  queue,
}: {
  work: FeedWork;
  // The full feed as a player queue (radio order). When present and this work is
  // streamable, the cover gets a play button that starts the queue from here.
  queue?: Track[];
}) {
  const visible = work.contributors.slice(0, MAX_VISIBLE_CHIPS);
  const overflow = work.contributors.length - visible.length;

  return (
    <article className="group flex flex-col gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3 transition hover:border-white/15 hover:bg-white/[0.04]">
      {/* The share button is a sibling of the cover Link, never a child — no
          nested anchors, and a tap on the icon never navigates to the song. */}
      <div className="relative">
        <Link
          href={`/registry/${work.id}`}
          className="relative block aspect-square overflow-hidden rounded-lg border border-white/8"
          aria-label={`Open AIRED-${work.id} ${work.title}`}
        >
          {work.artwork_url ? (
            <Image
              src={work.artwork_url}
              alt=""
              fill
              sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
              className="object-cover transition group-hover:scale-[1.02]"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white/[0.04] to-transparent text-[10px] uppercase tracking-[0.18em] text-muted/50">
              no art
            </div>
          )}
          {work.red_line_certified ? (
            <span className="absolute left-2 top-2 rounded-full border border-cert-red/50 bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-cert-red backdrop-blur">
              Red Line
            </span>
          ) : null}
        </Link>
        <ShareButton
          workId={work.id}
          title={work.title}
          contributorNames={work.contributors.map((c) => c.name)}
          compact
          className="absolute right-2 top-2 z-10 inline-flex size-9 items-center justify-center rounded-full border border-white/15 bg-background/70 text-foreground backdrop-blur transition hover:border-white/30 hover:bg-background/85 active:scale-95"
        />
        {queue && work.hls_playlist_key ? (
          <CardPlayButton queue={queue} workId={work.id} title={work.title} />
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Link
          href={`/registry/${work.id}`}
          className="block h-10 overflow-hidden transition hover:opacity-90"
        >
          <WorkTitle id={work.id} title={work.title} size="sm" />
        </Link>

        <ul className="flex h-6 flex-nowrap items-center gap-1.5 overflow-hidden">
          {visible.map((c) => {
            const chip = (
              <span className="block max-w-[7rem] truncate rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-muted transition hover:border-white/20 hover:text-foreground">
                {c.name}
              </span>
            );
            return (
              <li
                key={`${work.id}-${c.profile_slug ?? c.name}`}
                className="shrink-0"
              >
                {c.profile_slug ? (
                  <Link href={`/agent/${c.profile_slug}`}>{chip}</Link>
                ) : (
                  chip
                )}
              </li>
            );
          })}
          {overflow > 0 ? (
            <li className="shrink-0">
              <span
                className="block rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-muted"
                aria-label={`${overflow} more contributor${overflow === 1 ? "" : "s"}`}
                title={work.contributors
                  .slice(MAX_VISIBLE_CHIPS)
                  .map((c) => c.name)
                  .join(" · ")}
              >
                +{overflow}
              </span>
            </li>
          ) : null}
        </ul>

        <span className="block h-4 font-mono text-[11px] leading-4 text-muted/60">
          {work.duration_seconds != null ? formatDuration(work.duration_seconds) : ""}
        </span>
      </div>
    </article>
  );
}
