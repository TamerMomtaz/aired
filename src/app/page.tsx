import Link from "next/link";

import { AlbumCard } from "@/components/album-card";
import { ArtistShelfRow } from "@/components/artist-shelf-row";
import { trackFromFeedWork } from "@/components/player/track";
import { SearchBar } from "@/components/search-bar";
import { WorkCard } from "@/components/work-card";
import {
  getBrowseShelves,
  type BrowseShelves,
} from "@/lib/albums/public-queries";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getFeed,
  getMostAired,
  searchWorks,
  type FeedWork,
} from "@/lib/works/queries";

// Only crown a "Most Aired" strip once a few works have real listens — a
// one-item shelf isn't a ranking. Below this it stays hidden (counts still show
// on every card and song page).
const MOST_AIRED_MIN = 3;

export const metadata = { title: "AIRED — AI-ed and proud" };

// The listener's door, as a label (BROWSE-AS-LABEL). Browse leads with a MOST
// AIRED strip (one cross-artist, mixed row), then ALBUMS and SINGLES — each
// banded and grouped into one horizontal row PER ARTIST, fronted by the artist's
// name as a left spine linking to their page. Searching collapses back to one
// flat grid of matching works. Public surfaces are live-only (RLS + explicit
// filters); nothing draft/pending/taken-down ever appears.
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
  // Browse pulls the whole live catalog as the shared radio queue, the
  // artist-grouped ALBUMS + SINGLES shelves, and the Most Aired strip; Search
  // pulls just the matches and renders one flat grid.
  const emptyShelves: BrowseShelves = { albumRows: [], singleRows: [] };
  const [works, shelves, user, mostAired] = await Promise.all([
    isSearching ? searchWorks(supabase, q) : getFeed(supabase),
    isSearching ? Promise.resolve(emptyShelves) : getBrowseShelves(supabase),
    getCurrentUser(),
    isSearching ? Promise.resolve<FeedWork[]>([]) : getMostAired(supabase, 10),
  ]);

  // One shared queue: every streamable live work in catalog (radio) order, so
  // pressing play on any song card — single or Most Aired — rolls the catalog
  // onward from there. Album pages build their own album-scoped queue.
  const queue = works
    .map(trackFromFeedWork)
    .filter((t) => t.hlsPlaylistKey)
    .sort((a, b) => a.id - b.id);

  const showMostAired = !isSearching && mostAired.length >= MOST_AIRED_MIN;
  const hasBrowseContent =
    shelves.albumRows.length > 0 || shelves.singleRows.length > 0;

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

      {showMostAired ? (
        <section className="mb-8 flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
            Most Aired
          </h2>
          <ul className="flex gap-4 overflow-x-auto pb-1">
            {mostAired.map((work) => (
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
          {shelves.albumRows.length > 0 ? (
            <section className="flex flex-col gap-4">
              <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
                Albums
              </h2>
              <div className="flex flex-col gap-6">
                {shelves.albumRows.map((row) => (
                  <ArtistShelfRow
                    key={row.artistId}
                    artistId={row.artistId}
                    artistHandle={row.artistHandle}
                    artistName={row.artistName}
                  >
                    {row.albums.map((album) => (
                      <li key={album.id} className="w-40 shrink-0 sm:w-48">
                        <AlbumCard album={album} />
                      </li>
                    ))}
                  </ArtistShelfRow>
                ))}
              </div>
            </section>
          ) : null}

          {shelves.singleRows.length > 0 ? (
            <section className="flex flex-col gap-4">
              <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
                Singles
              </h2>
              <div className="flex flex-col gap-6">
                {shelves.singleRows.map((row) => (
                  <ArtistShelfRow
                    key={row.artistId}
                    artistId={row.artistId}
                    artistHandle={row.artistHandle}
                    artistName={row.artistName}
                  >
                    {row.singles.map((work) => (
                      <li key={work.id} className="w-40 shrink-0 sm:w-48">
                        <WorkCard work={work} queue={queue} />
                      </li>
                    ))}
                  </ArtistShelfRow>
                ))}
              </div>
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
