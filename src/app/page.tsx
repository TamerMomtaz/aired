import Link from "next/link";

import { AlbumCard } from "@/components/album-card";
import { trackFromFeedWork } from "@/components/player/track";
import { SearchBar } from "@/components/search-bar";
import { WorkCard } from "@/components/work-card";
import {
  getBrowseAlbums,
  type AlbumCardData,
} from "@/lib/albums/public-queries";
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

// The listener's door, as a label (BROWSE-AS-LABEL). Browse shows a Most-Played
// strip, then a shelf of ALBUMS (covers that open to their songs), then SINGLES
// (album-less works as song cards). Searching collapses back to one flat grid of
// matching works. Public surfaces are live-only (RLS + explicit filters); nothing
// draft/pending ever appears.
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
  // Browse pulls the whole live catalog (the radio queue + the singles split) plus
  // the album shelf and the most-played strip; Search pulls just the matches.
  // album_id rides along on the feed, so singles fall out of one query.
  const [works, albums, user, mostPlayed] = await Promise.all([
    isSearching ? searchWorks(supabase, q) : getFeed(supabase),
    isSearching
      ? Promise.resolve<AlbumCardData[]>([])
      : getBrowseAlbums(supabase),
    getCurrentUser(),
    isSearching ? Promise.resolve<FeedWork[]>([]) : getMostPlayed(supabase, 10),
  ]);

  // One shared queue: every streamable live work in catalog (radio) order, so
  // pressing play on any song card — single or most-played — rolls the catalog
  // onward from there. Album pages build their own album-scoped queue.
  const queue = works
    .map(trackFromFeedWork)
    .filter((t) => t.hlsPlaylistKey)
    .sort((a, b) => a.id - b.id);

  // Singles = album-less live works (a single is a one-track release). Album
  // songs live behind their cover, not in this flat shelf.
  const singles = isSearching ? [] : works.filter((w) => w.album_id === null);

  const showMostPlayed = !isSearching && mostPlayed.length >= MOST_PLAYED_MIN;
  const hasBrowseContent = albums.length > 0 || singles.length > 0;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:py-10">
      <header className="mb-7 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
            {isSearching ? "Search" : "Listen"}
          </h1>
          <p className="text-sm text-muted">
            {isSearching
              ? "Works whose title, AIRED-####, contributor, album, or artist match."
              : "A label of albums and singles — every AIRED work, credited to everyone who made it, carbon and silicon alike."}
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

      {isSearching ? (
        works.length > 0 ? (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {works.map((work) => (
              <li key={work.id}>
                <WorkCard work={work} queue={queue} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyResults query={q} />
        )
      ) : hasBrowseContent ? (
        <div className="flex flex-col gap-10">
          {albums.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
                Albums
              </h2>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {albums.map((album) => (
                  <li key={album.id}>
                    <AlbumCard album={album} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {singles.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
                Singles
              </h2>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {singles.map((work) => (
                  <li key={work.id}>
                    <WorkCard work={work} queue={queue} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
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
        yet. Try a different title, AIRED number, contributor, album, or artist.
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
