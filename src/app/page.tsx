import Link from "next/link";

import { trackFromFeedWork } from "@/components/player/track";
import { SearchBar } from "@/components/search-bar";
import { WorkCard } from "@/components/work-card";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getFeed,
  getMostPlayed,
  searchWorks,
  type FeedWork,
} from "@/lib/works/queries";

// Only crown a "Most played" strip once a few works have real listens — a
// one-item shelf isn't a ranking. Below this it stays hidden (counts still show
// on every card and song page).
const MOST_PLAYED_MIN = 3;

export const metadata = { title: "AIRED — AI-ed and proud" };

// The listener's door. The catalog is the front page: live works, newest first,
// with search up top. A maker who arrives here gets a clear Create CTA (the
// site header carries the Listen/Create split); a listener gets to listen.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawQ = Array.isArray(params.q) ? params.q[0] : params.q;
  const q = (rawQ ?? "").trim();
  const isSearching = q.length > 0;

  const supabase = await createClient();
  // Every card carries its real listen count for free — play_count rides along
  // in the feed/search select (denormalized on `work`).
  const [works, user, mostPlayed] = await Promise.all([
    isSearching ? searchWorks(supabase, q) : getFeed(supabase),
    getCurrentUser(),
    // The Most Played strip only makes sense on the default Browse view.
    isSearching ? Promise.resolve<FeedWork[]>([]) : getMostPlayed(supabase, 10),
  ]);

  // One shared queue for the whole grid: every streamable work, in catalog
  // (radio) order, so pressing play on a card rolls the catalog onward from
  // there while the grid itself stays newest-first. The Most Played strip reuses
  // it, so play-from-there continues the catalog too.
  const queue = works
    .map(trackFromFeedWork)
    .filter((t) => t.hlsPlaylistKey)
    .sort((a, b) => a.id - b.id);

  const showMostPlayed = !isSearching && mostPlayed.length >= MOST_PLAYED_MIN;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:py-10">
      <header className="mb-7 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            {isSearching ? "Search" : "Listen"}
          </h1>
          <p className="text-sm text-muted">
            {isSearching
              ? "Works whose title, AIRED-####, or contributor name match."
              : "Every AIRED work, freshest first — credited to everyone who made it, carbon and silicon alike."}
          </p>
        </div>
        <SearchBar initial={q} autoFocus={isSearching} />
      </header>

      {showMostPlayed ? (
        <section className="mb-8 flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
            Most played
          </h2>
          <ul className="flex gap-4 overflow-x-auto pb-1">
            {mostPlayed.map((work) => (
              <li key={work.id} className="w-40 shrink-0 sm:w-48">
                <WorkCard work={work} queue={queue} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {works.length > 0 ? (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {works.map((work) => (
            <li key={work.id}>
              <WorkCard work={work} queue={queue} />
            </li>
          ))}
        </ul>
      ) : isSearching ? (
        <EmptyResults query={q} />
      ) : (
        <EmptyFeed signedIn={!!user} />
      )}
    </main>
  );
}

function EmptyResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
      <p className="max-w-md text-sm leading-relaxed text-muted">
        No works match{" "}
        <span className="font-mono text-foreground">&ldquo;{query}&rdquo;</span>{" "}
        yet. Try a different title, AIRED number, or contributor name.
      </p>
      <Link
        href="/"
        className="rounded-lg border border-white/12 px-4 py-2.5 text-sm font-medium text-foreground transition hover:bg-white/[0.06]"
      >
        Back to Browse
      </Link>
    </div>
  );
}

function EmptyFeed({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
      <span className="font-mono text-sm uppercase tracking-[0.18em] text-muted/60">
        AIRED-0001 · awaiting
      </span>
      <p className="max-w-md text-sm leading-relaxed text-muted">
        Nothing live yet. The first ledger writes the first work.
      </p>
      <Link
        href={signedIn ? "/upload" : "/signup?next=/upload"}
        className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
      >
        {signedIn ? "Upload the first work" : "Start your ledger"}
      </Link>
    </div>
  );
}
