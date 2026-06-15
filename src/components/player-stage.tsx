"use client";

import { useRef, useState } from "react";

import { RedLinePlayer } from "@/components/RedLinePlayer";
import { LyricsSyncEditor } from "@/components/lyrics-sync-editor";
import { SyncedLyrics } from "@/components/synced-lyrics";

// Composes the Red Line player with the synced lyrics so they share one clock:
// the player reports time → the lyrics light up. Hear it → read it → see who
// made it. Owners also get the tap-sync editor here (Phase 4).
export function PlayerStage({
  hlsPlaylistKey,
  workId,
  title,
  lyrics,
  isOwner,
}: {
  hlsPlaylistKey: string | null | undefined;
  workId: number;
  title: string;
  lyrics: string | null;
  isOwner: boolean;
}) {
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef<HTMLDivElement | null>(null);

  // When the owner enters sync mode its own <audio> takes over — pause the
  // public player so the two never play at once. RedLinePlayer's API stays
  // frozen, so we reach its element through this scoped ref.
  function pausePublicPlayer() {
    playerRef.current?.querySelectorAll("audio").forEach((a) => {
      try {
        a.pause();
      } catch {
        // already paused / detached — ignore
      }
    });
  }

  const showPublicLyrics = !!(lyrics && lyrics.trim());

  return (
    <>
      <section className="mb-8" ref={playerRef}>
        <RedLinePlayer
          hlsPlaylistKey={hlsPlaylistKey}
          workId={workId}
          title={title}
          onTimeUpdate={setCurrentTime}
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
              workId={workId}
              hlsPlaylistKey={hlsPlaylistKey}
              initialLyrics={lyrics}
              onEnterSync={pausePublicPlayer}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
