import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { MoodSettings } from "@/components/library/mood-settings";
import { MoodSongList, type MoodSong } from "@/components/library/mood-song-list";
import { PlayAllButton } from "@/components/library/play-all-button";
import { trackFromFeedWork } from "@/components/player/track";
import { getMoodDetail } from "@/lib/library/queries";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return { title: "Moods Feed · AIRED" };
  const supabase = await createClient();
  const mood = await getMoodDetail(supabase, id);
  return { title: mood ? `${mood.name} · AIRED` : "Moods Feed · AIRED" };
}

// One mood: its songs in the order the listener put them, playable as a queue.
//
// A mood nobody owns and a mood owned by someone else are the same thing from
// here — RLS returns no row either way, and the page 404s. That is the honest
// answer to a guessed URL: it neither confirms nor denies that a mood exists.
export default async function MoodPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=/moods/${id}`);

  const supabase = await createClient();
  const mood = await getMoodDetail(supabase, id);
  if (!mood) notFound();

  const songs: MoodSong[] = mood.songs.map((s) => ({
    itemId: s.itemId,
    track: trackFromFeedWork(s.work),
  }));
  const queue = songs.map((s) => s.track).filter((t) => t.hlsPlaylistKey);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-8 sm:py-10">
      <nav className="mb-5">
        <Link
          href="/moods"
          className="text-xs text-muted transition hover:text-foreground"
        >
          ← Moods Feed
        </Link>
      </nav>

      <header className="mb-7 flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
              {mood.name}
            </h1>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted/60">
              {songs.length} {songs.length === 1 ? "song" : "songs"} · yours
              alone
            </p>
          </div>
          <MoodSettings moodId={mood.id} name={mood.name} />
        </div>
        {queue.length > 0 ? <PlayAllButton queue={queue} /> : null}
      </header>

      {songs.length > 0 ? (
        <MoodSongList moodId={mood.id} songs={songs} />
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Nothing in this mood yet. Find a song and use{" "}
            <span className="text-foreground">Add to a mood</span> — it lands at
            the end, and you can move it wherever it belongs.
          </p>
          <Link
            href="/"
            className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
          >
            Go listening
          </Link>
        </div>
      )}
    </main>
  );
}
