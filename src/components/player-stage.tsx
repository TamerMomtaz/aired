"use client";

import { RedLinePlayer } from "@/components/RedLinePlayer";
import { LyricsSyncEditor } from "@/components/lyrics-sync-editor";
import { usePlayer, usePlayerClock } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";
import { SyncedLyrics } from "@/components/synced-lyrics";

// Composes the Red Line player with the synced lyrics so they share one clock:
// the global engine reports time → the lyrics light up. Hear it → read it → see
// who made it. Owners also get the tap-sync editor here (Phase 4).
//
// The clock only drives the lyrics while THIS work is the one playing. If the
// listener is reading this page while a different track plays in the now-playing
// bar, the lyrics rest until they press play here (which seeds the queue from
// this song onward).
export function PlayerStage({
  track,
  queue,
  lyrics,
  isOwner,
}: {
  track: Track;
  queue: Track[];
  lyrics: string | null;
  isOwner: boolean;
}) {
  const player = usePlayer();
  const clock = usePlayerClock();

  const isCurrent = player.current?.id === track.id;
  const currentTime = isCurrent ? clock : 0;

  // Where playing this page's song drops into the queue. A draft that isn't in
  // the public feed falls back to a queue of just itself.
  const found = queue.findIndex((t) => t.id === track.id);
  const effectiveQueue = found >= 0 ? queue : [track];
  const effectiveIndex = found >= 0 ? found : 0;

  const showPublicLyrics = !!(lyrics && lyrics.trim());

  return (
    <>
      <section className="mb-8">
        <RedLinePlayer
          track={track}
          queue={effectiveQueue}
          startIndex={effectiveIndex}
        />
      </section>

      {showPublicLyrics || isOwner ? (
        <section className="mb-8 flex flex-col gap-3">
          {showPublicLyrics ? (
            <h2 className="text-xs uppercase tracking-[0.18em] text-muted/70">
              Lyrics
            </h2>
          ) : null}
          <SyncedLyrics lyrics={lyrics} currentTime={currentTime} />
          {isOwner ? (
            <LyricsSyncEditor
              workId={track.id}
              hlsPlaylistKey={track.hlsPlaylistKey}
              initialLyrics={lyrics}
              onEnterSync={player.pause}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
