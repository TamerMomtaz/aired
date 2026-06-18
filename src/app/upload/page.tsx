import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { UploadForm } from "@/components/upload/upload-form";
import { WorkTitle } from "@/components/work-title";
import { DiscardButton } from "@/components/works/discard-button";
import { getMyAlbumOptions } from "@/lib/albums/queries";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getMyDrafts } from "@/lib/works/queries";

export const metadata = { title: "Upload · AIRED" };

// Uploading is creator-only. Authorization still lives at the data layer (RLS);
// this redirect is for UX. Carry `next=/upload` so the listener-turned-maker
// lands back here the moment they finish logging in or signing up.
export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/upload");

  // The album step's picker, and any unpublished drafts to RESUME — surfaced so a
  // creator continues an in-progress work instead of starting fresh and minting
  // another orphan (EDIT & TIDY).
  const supabase = await createClient();
  const [albums, drafts] = await Promise.all([
    getMyAlbumOptions(supabase, user.id),
    getMyDrafts(supabase, user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-5 py-10">
      <header className="mb-8 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">
          Upload a work
        </h1>
        <p className="text-sm text-muted">
          Title, audio, artwork. It lands as a draft so you can declare its
          Volley Ledger — then it becomes an AIRED work.
        </p>
      </header>

      {drafts.length > 0 ? (
        <section className="mb-8 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
              Resume a draft
            </h2>
            <p className="text-xs text-muted">
              You have {drafts.length} unpublished{" "}
              {drafts.length === 1 ? "draft" : "drafts"} in progress. Pick up
              where you left off instead of starting fresh.
            </p>
          </div>
          <ul className="flex flex-col divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {d.artworkUrl ? (
                    <Image
                      src={d.artworkUrl}
                      alt={`Artwork for ${d.title}`}
                      width={40}
                      height={40}
                      className="size-10 shrink-0 rounded-md border border-white/10 object-cover"
                      unoptimized
                    />
                  ) : (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-dashed border-white/12 text-[8px] uppercase tracking-[0.12em] text-muted/50">
                      no art
                    </div>
                  )}
                  <WorkTitle id={d.id} title={d.title} size="sm" />
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Link
                    href={`/registry/${d.id}`}
                    className="rounded-lg bg-cert-red px-3.5 py-2 text-sm font-medium text-white transition hover:brightness-110"
                  >
                    Resume →
                  </Link>
                  <DiscardButton
                    workId={d.id}
                    status="draft"
                    playCount={0}
                    certified={false}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="text-center text-[11px] text-muted/60">
            Or start a new one below.
          </p>
        </section>
      ) : null}

      <UploadForm albums={albums} />

      <p className="mt-6 text-center text-xs text-muted/70">
        Haven&apos;t claimed your name yet?{" "}
        <Link
          href="/claim"
          className="text-foreground underline-offset-4 hover:underline"
        >
          Do that first
        </Link>{" "}
        so the ledger can credit you.
      </p>
    </main>
  );
}
