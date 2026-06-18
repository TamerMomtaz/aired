import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { RedLinePlayer } from "@/components/RedLinePlayer";
import type { Track } from "@/components/player/track";
import { ReviewActions } from "@/components/review/review-actions";
import { WorkTitle } from "@/components/work-title";
import { formatDuration } from "@/lib/format";
import { parseLrc } from "@/lib/lyrics/lrc";
import {
  getPendingReviewWorks,
  getTakenDownCount,
} from "@/lib/review/queries";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Review · AIRED" };

// The Review queue — ADMIN ONLY. Non-trusted creators' publishes land here as
// 'pending' and wait for an admin to Approve / Decline / Trust. The redirect
// below is the UX guard; the real enforcement is the RLS (`work_admin_read` is
// the only reason these hidden works are even readable) plus the review RPCs'
// own admin asserts. A non-admin who somehow reached the data would get nothing.
export default async function ReviewPage() {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) redirect("/");

  const supabase = await createClient();
  const [works, takenDownCount] = await Promise.all([
    getPendingReviewWorks(supabase),
    getTakenDownCount(supabase),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">Review</h1>
          <Link
            href="/review/taken-down"
            className="rounded-lg border border-white/12 px-3.5 py-1.5 text-sm text-muted transition hover:border-cert-red/40 hover:text-foreground"
          >
            Taken down{takenDownCount > 0 ? ` (${takenDownCount})` : ""}
          </Link>
        </div>
        <p className="text-sm text-muted">
          Newcomers&apos; publishes wait here for a look. Trusted creators skip
          the line. AIRED&apos;s single rule: no hate, no violence, no
          dehumanization. Everything else is welcome.
        </p>
      </header>

      {works.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
          <span aria-hidden className="h-[3px] w-16 rounded-full bg-cert-red/50" />
          <p className="text-sm text-muted">
            Nothing waiting — the line is clear.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-6">
          {works.map((work) => {
            const track: Track = {
              id: work.id,
              title: work.title,
              hlsPlaylistKey: work.hlsPlaylistKey,
              artworkUrl: work.artworkUrl,
              durationSeconds: work.durationSeconds,
              contributors: work.contributors,
            };
            const lyricLines = parseLrc(work.lyrics).map((l) => l.text);
            const hasLyrics = lyricLines.some((l) => l.trim().length > 0);

            return (
              <li
                key={work.id}
                className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="flex gap-4">
                  {work.artworkUrl ? (
                    <Image
                      src={work.artworkUrl}
                      alt={`Artwork for ${work.title}`}
                      width={80}
                      height={80}
                      className="size-20 shrink-0 rounded-xl border border-white/10 object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex size-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/12 text-[9px] uppercase tracking-[0.16em] text-muted/50">
                      no art
                    </div>
                  )}

                  <div className="flex min-w-0 flex-col gap-2">
                    <WorkTitle id={work.id} title={work.title} />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="rounded-full border border-amber-400/40 px-2.5 py-0.5 uppercase tracking-[0.14em] text-amber-300">
                        In review
                      </span>
                      <span className="text-muted/70">
                        {formatDuration(work.durationSeconds)}
                      </span>
                    </div>
                    <p className="text-sm text-muted">
                      Uploaded by{" "}
                      <span className="text-foreground">{work.uploaderName}</span>
                    </p>
                  </div>
                </div>

                {work.contributors.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-muted/60">
                      Contributors
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {work.contributors.map((c) => (
                        <span
                          key={c.profile_slug ?? c.name}
                          className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-0.5 text-xs text-muted"
                        >
                          {c.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                <RedLinePlayer track={track} queue={[track]} startIndex={0} />

                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-muted/60">
                    Lyrics
                  </span>
                  {hasLyrics ? (
                    <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/8 bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-foreground/90">
                      {lyricLines.join("\n")}
                    </div>
                  ) : (
                    <p className="text-xs text-muted/60">No lyrics provided.</p>
                  )}
                </div>

                <ReviewActions
                  workId={work.id}
                  creatorId={work.creatorId}
                  uploaderName={work.uploaderName}
                />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
