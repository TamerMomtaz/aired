import Image from "next/image";
import Link from "next/link";

import { WorkTitle } from "@/components/work-title";
import { formatDuration } from "@/lib/format";
import type { FeedWork } from "@/lib/works/queries";

// One tile on the listener's Browse feed: cover, AIRED-#### · title, the
// contributors as followable chips (each linking to /agent/[slug]), a Red Line
// badge when certified, and the duration. Click the cover or title to open the
// work — chips link to the contributor's page, so we keep them outside the
// outer link (no nested anchors).
export function WorkCard({ work }: { work: FeedWork }) {
  return (
    <article className="group flex flex-col gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3 transition hover:border-white/15 hover:bg-white/[0.04]">
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

      <div className="flex flex-col gap-2">
        <Link
          href={`/registry/${work.id}`}
          className="block transition hover:opacity-90"
        >
          <WorkTitle id={work.id} title={work.title} size="sm" />
        </Link>

        {work.contributors.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {work.contributors.map((c) => {
              const chip = (
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-muted transition hover:border-white/20 hover:text-foreground">
                  {c.name}
                </span>
              );
              return (
                <li key={`${work.id}-${c.profile_slug ?? c.name}`}>
                  {c.profile_slug ? (
                    <Link href={`/agent/${c.profile_slug}`}>{chip}</Link>
                  ) : (
                    chip
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}

        {work.duration_seconds != null ? (
          <span className="font-mono text-[11px] text-muted/60">
            {formatDuration(work.duration_seconds)}
          </span>
        ) : null}
      </div>
    </article>
  );
}
