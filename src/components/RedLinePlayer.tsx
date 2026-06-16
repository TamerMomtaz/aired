"use client";

import { useRef, useState } from "react";

import { usePlayer, usePlayerClock } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";
import { formatDuration } from "@/lib/format";
import { R2_BASE, buildStreamUrl } from "@/lib/stream-url";

// The Red Line made kinetic (CLAUDE.md §3): a progress bar that IS the brand mark
// — cert-red on near-black, scrub-to-seek. This is now a PRESENTATIONAL view over
// the single global engine (player-provider): it owns no audio, only the transport
// UI for one work. When this work is the engine's current track it mirrors live
// playback; otherwise it shows the work at rest and its play button seeds the queue
// from here ("play from here") so the catalog keeps rolling.

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function RedLinePlayer({
  track,
  queue,
  startIndex,
}: {
  track: Track;
  // The list to play from when the listener presses play on this page, and this
  // work's position in it (the "radio from here" seed). For a track that isn't in
  // a public feed (e.g. a draft) this is simply [track] at 0.
  queue: Track[];
  startIndex: number;
}) {
  const player = usePlayer();
  const clock = usePlayerClock();

  const barRef = useRef<HTMLDivElement | null>(null);
  // While scrubbing, the bar follows the pointer immediately (0..1, else null).
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const workId = track.id;
  const title = track.title;
  const isCurrent = player.current?.id === track.id;

  // Mirror the engine when this work is the one playing; show it at rest (its own
  // known length, a quiet bar) when something else holds the engine.
  const isPlaying = isCurrent && player.isPlaying;
  // Prefer the engine's measured length once known; fall back to the work's
  // stored duration so a sensible total shows at rest and before metadata loads.
  const duration =
    isCurrent && player.duration > 0
      ? player.duration
      : track.durationSeconds ?? 0;
  const currentTime = isCurrent ? clock : 0;
  const buffering = isCurrent && player.buffering;
  const loadError = isCurrent && player.loadError;

  const streamUrl = buildStreamUrl(track.hlsPlaylistKey);
  const hasKey = !!(track.hlsPlaylistKey && track.hlsPlaylistKey.trim());

  function onPlayPause() {
    // Mirror the engine when this work is current; otherwise seed the queue from
    // here so pressing play continues the catalog onward.
    if (isCurrent) player.toggle();
    else player.playQueue(queue, startIndex);
  }

  // --- Seeking: click or drag anywhere on the Red Line (only when live) -----
  function fractionFromClientX(clientX: number): number {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp01((clientX - rect.left) / rect.width);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isCurrent || !duration) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const fraction = fractionFromClientX(e.clientX);
    setDragFraction(fraction);
    player.seek(fraction);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragFraction === null) return;
    const fraction = fractionFromClientX(e.clientX);
    setDragFraction(fraction);
    player.seek(fraction); // VOD seeks smoothly; the bar tracks the finger
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (dragFraction === null) return;
    player.seek(fractionFromClientX(e.clientX));
    setDragFraction(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone — ignore
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onPlayPause();
      return;
    }
    if (!isCurrent || !duration) return;
    const step = 5;
    let nextTime: number | null = null;
    if (e.key === "ArrowRight") nextTime = Math.min(duration, currentTime + step);
    else if (e.key === "ArrowLeft") nextTime = Math.max(0, currentTime - step);
    else if (e.key === "Home") nextTime = 0;
    else if (e.key === "End") nextTime = duration;
    if (nextTime !== null) {
      e.preventDefault();
      player.seekToTime(nextTime);
    }
  }

  const playedFraction =
    dragFraction !== null
      ? dragFraction
      : duration > 0
        ? clamp01(currentTime / duration)
        : 0;
  const pct = `${playedFraction * 100}%`;
  const redGlow = "0 0 12px color-mix(in srgb, var(--cert-red) 70%, transparent)";
  const headGlow =
    "0 0 14px 2px color-mix(in srgb, var(--cert-red) 80%, transparent)";

  // No playable source yet (not transcoded, or base not configured): a quiet
  // Red Line at rest, so the page composition stays intact.
  if (!streamUrl) {
    if (hasKey && !R2_BASE) {
      console.warn(
        "[RedLinePlayer] NEXT_PUBLIC_R2_PUBLIC_BASE is not set — cannot build the stream URL.",
      );
    }
    return (
      <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/12 text-muted/50"
        >
          <PlayIcon />
        </span>
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-[3px] w-full rounded-full bg-cert-red/15" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Not streaming yet</span>
            <span className="font-mono text-[11px] text-muted/60">
              {formatDuration(null)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <button
        type="button"
        onClick={onPlayPause}
        disabled={loadError}
        aria-label={isPlaying ? `Pause ${title}` : `Play ${title}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cert-red text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 disabled:opacity-40"
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <div className="flex flex-1 flex-col gap-2">
        {loadError ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-cert-red">
              Couldn&apos;t load the stream.
            </span>
            <button
              type="button"
              onClick={player.retry}
              className="rounded-md border border-cert-red/40 px-2.5 py-1 text-xs text-cert-red transition hover:bg-cert-red/10"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* The Red Line: tap or drag anywhere to seek. The thin line is the
                visual; the padded wrapper is a finger-friendly hit area. */}
            <div
              ref={barRef}
              role="slider"
              tabIndex={0}
              aria-label={`Seek ${title}`}
              aria-valuemin={0}
              aria-valuemax={Math.round(duration) || 0}
              aria-valuenow={Math.round(
                dragFraction !== null ? dragFraction * duration : currentTime,
              )}
              aria-valuetext={formatDuration(
                dragFraction !== null ? dragFraction * duration : currentTime,
              )}
              aria-busy={buffering}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown}
              className="group relative -my-2 cursor-pointer touch-none select-none py-2 focus-visible:outline-none"
            >
              <div className="relative h-[3px] w-full rounded-full bg-cert-red/15 group-focus-visible:ring-2 group-focus-visible:ring-cert-red/40">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-cert-red"
                  style={{ width: pct, boxShadow: redGlow }}
                />
                <div
                  className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cert-red ${
                    buffering ? "motion-safe:animate-pulse" : ""
                  }`}
                  style={{ left: pct, boxShadow: headGlow }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between font-mono text-[11px] text-muted">
              <span>{formatDuration(currentTime)}</span>
              {buffering ? (
                <span className="text-cert-red/70 motion-safe:animate-pulse">
                  buffering…
                </span>
              ) : null}
              <span>{duration > 0 ? formatDuration(duration) : "—"}</span>
            </div>
          </>
        )}
      </div>

      <span className="sr-only">
        Streaming AIRED-{String(workId)} · {title}
      </span>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden fill="currentColor">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.5-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
