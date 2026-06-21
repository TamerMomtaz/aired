"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

import { usePlayer } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";
import { buildStreamUrl } from "@/lib/stream-url";

// LANDING CONVERSION — the shared-song arrival hero.
//
// ~85% of share-card visitors land on /registry/[id] and leave without pressing
// play. This makes PLAY the one obvious, immediate, one-tap act: a big tap target
// over the artwork, pulsing until sound is going. We ATTEMPT audible autoplay on
// mount, but only from a cold engine (a fresh arrival has nothing queued) so we
// never hijack a listen already in progress. Browsers block autoplay-with-sound on
// a first visit, so when it doesn't take, the pulsing "Tap to play" overlay stays
// up — one tap = sound. Never silent, never broken. (Muted-autoplay tricks don't
// help an audio app, so we don't use them — the clear tap-to-play wins.)
//
// This owns no audio: it drives the single global engine (player-provider) exactly
// like the Red Line transport below it. First paint is just the <Image> + a static
// overlay (server-rendered), so the play affordance is usable before hydration; the
// autoplay attempt and tap handler attach on hydration.
export function PlayHero({
  track,
  queue,
  startIndex,
}: {
  track: Track;
  // The list to play from when the visitor presses play (radio "from here"), and
  // this work's index in it. For a work outside the public feed it's [track] at 0.
  queue: Track[];
  startIndex: number;
}) {
  const player = usePlayer();

  const isCurrent = player.current?.id === track.id;
  // "Active" tracks ACTUAL playback, never mere buffering. A blocked audible
  // autoplay still attaches + buffers the source (buffering goes true) while no
  // sound plays — keying off that would show a "playing" pause control over a
  // silent player, the one thing the brief forbids. A gesture-started play fires
  // `play` near-instantly, so isPlaying is the honest signal; buffering is then
  // surfaced inside the corner control as a spinner.
  const isActive = isCurrent && player.isPlaying;
  const hasStream = !!buildStreamUrl(track.hlsPlaylistKey);

  // One audible-autoplay attempt, at first mount, only when the engine is cold.
  // The ref guards against the harmless re-runs (the memoized `player` value
  // changes as transport state ticks); the cold-engine check means we never
  // interrupt a listen the visitor already started elsewhere.
  const triedAutoplay = useRef(false);
  useEffect(() => {
    if (triedAutoplay.current) return;
    triedAutoplay.current = true;
    if (!hasStream) return;
    if (player.current) return; // something's already loaded — don't hijack it
    player.playQueue(queue, startIndex);
  }, [hasStream, player, queue, startIndex]);

  function start() {
    if (!hasStream) return;
    if (isCurrent) player.toggle();
    else player.playQueue(queue, startIndex);
  }

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(82vw,320px)]">
      {track.artworkUrl ? (
        <Image
          src={track.artworkUrl}
          alt={`Artwork for ${track.title}`}
          fill
          sizes="(min-width: 640px) 320px, 82vw"
          className="rounded-2xl border border-white/10 object-cover"
          unoptimized
          loading="eager"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-white/12 text-[11px] uppercase tracking-[0.18em] text-muted/50">
          no art
        </div>
      )}

      {hasStream && isActive ? (
        // Sound is going — the art just displays; a clear corner control pauses.
        // The Red Line transport below is the primary scrub/seek, so tapping the
        // art itself does nothing (no accidental pauses while reading along).
        <button
          type="button"
          onClick={() => player.toggle()}
          aria-label={`Pause ${track.title}`}
          className="absolute bottom-3 right-3 flex size-12 items-center justify-center rounded-full bg-cert-red text-white shadow-[0_0_20px_-4px_var(--cert-red)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {player.buffering ? (
            <span className="size-2.5 rounded-full bg-white motion-safe:animate-pulse" />
          ) : (
            <PauseIcon />
          )}
        </button>
      ) : hasStream ? (
        // The one thing to do on a share-arrival: press play. Full-cover tap
        // target, pulsing until sound starts — the tap-to-play fallback for when
        // the browser blocks audible autoplay.
        <button
          type="button"
          onClick={start}
          aria-label={`Play ${track.title}`}
          className="group absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-background/45 transition hover:bg-background/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/60"
        >
          <span className="aired-beckon flex size-[4.5rem] items-center justify-center rounded-full bg-cert-red text-white">
            <PlayIcon />
          </span>
          <span className="rounded-full bg-background/70 px-3 py-1 text-xs font-medium tracking-wide text-foreground backdrop-blur">
            Tap to play
          </span>
        </button>
      ) : null}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-7" aria-hidden fill="currentColor">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.5-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
