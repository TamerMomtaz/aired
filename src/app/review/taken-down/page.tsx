import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { WorkTitle } from "@/components/work-title";
import { AdminTakedownControls } from "@/components/works/admin-takedown";
import { getTakenDownWorks } from "@/lib/review/queries";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Taken down · AIRED" };

// The admin Taken-down list (governance). Works an admin has pulled off the
// public shelf — even ones that were live / approved — each with the reason the
// owner sees and a Restore. ADMIN ONLY: the redirect is the UX guard; the real
// enforcement is work_admin_read (lets these public-hidden rows be read) plus the
// admin_restore_work RPC's own assert.
export default async function TakenDownPage() {
  const profile = await getCurrentProfile();
  if (!profile?.is_admin) redirect("/");

  const supabase = await createClient();
  const works = await getTakenDownWorks(supabase);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-2">
        <Link
          href="/review"
          className="text-xs text-muted transition hover:text-foreground"
        >
          ← Review queue
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">Taken down</h1>
        <p className="text-sm text-muted">
          Works pulled off every public surface. The owner keeps the work and
          sees the reason, but cannot re-publish it — only a Restore here brings
          it back.
        </p>
      </header>

      {works.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
          <span aria-hidden className="h-[3px] w-16 rounded-full bg-cert-red/50" />
          <p className="text-sm text-muted">
            Nothing taken down — the shelf is clean.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-5">
          {works.map((work) => (
            <li
              key={work.id}
              className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5"
            >
              <div className="flex gap-4">
                {work.artworkUrl ? (
                  <Image
                    src={work.artworkUrl}
                    alt={`Artwork for ${work.title}`}
                    width={64}
                    height={64}
                    className="size-16 shrink-0 rounded-xl border border-white/10 object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/12 text-[9px] uppercase tracking-[0.16em] text-muted/50">
                    no art
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-1.5">
                  <WorkTitle id={work.id} title={work.title} size="sm" />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="rounded-full border border-white/15 px-2.5 py-0.5 uppercase tracking-[0.14em] text-muted/80">
                      was {work.status}
                    </span>
                    <span>
                      by{" "}
                      <span className="text-foreground">{work.uploaderName}</span>
                    </span>
                  </div>
                </div>
              </div>

              <AdminTakedownControls
                workId={work.id}
                takenDown
                reason={work.takedownReason}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
