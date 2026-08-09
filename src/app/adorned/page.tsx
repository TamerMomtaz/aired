import Link from "next/link";
import { redirect } from "next/navigation";

import { PlayAllButton } from "@/components/library/play-all-button";
import { ShelfTabs } from "@/components/library/shelf-tabs";
import { trackFromFeedWork } from "@/components/player/track";
import { WorkCard } from "@/components/work-card";
import { getAdornedWorks } from "@/lib/library/queries";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Adorned · AIRED" };

// The listener's own shelf. Newest kept first — the order you adorned them in,
// not the order they were made, because this is your record and not the
// catalog's.
//
// A song you adorned and that has since been pulled simply isn't here (the
// query filters to live works); the row stays in the database, so if it ever
// returns, so does your adornment.
export default async function AdornedPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/adorned");

  const supabase = await createClient();
  const works = await getAdornedWorks(supabase, user.id);

  const queue = works
    .map(trackFromFeedWork)
    .filter((t) => t.hlsPlaylistKey);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:py-10">
      {/* On a phone the header carries one Shelf entry for both shelves; these
          tabs are how Moods stays one tap away. Above sm: the rail names them
          both and the tabs step aside. */}
      <ShelfTabs />

      <header className="mb-7 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            Adorned
          </h1>
          <p className="text-sm text-muted">
            {works.length > 0
              ? "The songs you kept. The ledger credits who made a work; this is you crediting it back."
              : "Nothing kept yet."}
          </p>
        </div>
        {queue.length > 0 ? (
          <div className="flex items-center gap-3">
            <PlayAllButton queue={queue} />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted/60">
              {works.length} {works.length === 1 ? "song" : "songs"}
            </span>
          </div>
        ) : null}
      </header>

      {works.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {works.map((work) => (
            <li key={work.id}>
              <WorkCard work={work} queue={queue} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
          <span aria-hidden className="text-3xl leading-none text-adorn-blue/70">
            ☥
          </span>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Tap the ankh on any song and it waits for you here — no hunting for
            the name next time.
          </p>
          <Link
            href="/"
            className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
          >
            Find something to keep
          </Link>
        </div>
      )}
    </main>
  );
}
