"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";

import { DownloadButton } from "@/components/offline/download-button";
import { usePlayer, usePlayerClock } from "@/components/player/player-provider";
import { formatCatalogId } from "@/lib/catalog";

// The persistent now-playing bar: it rides along the bottom of every page while
// the queue plays, so audio keeps going as the listener browses. Hear the catalog
// roll on; tap the title to open the work; prev/play/next move through the queue.
// Hidden until something is queued. Contributor names ride here too — public and
// celebrated (CLAUDE.md §3a), never a style descriptor.

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function NowPlayingBar() {
  const player = usePlayer();
  const clock = usePlayerClock();

  const barRef = useRef<HTMLDivElement | null>(null);
  const [dragFraction, setDragFraction] = useState<number | null>(null);

  const current = player.current;
  // Nothing has been played yet — no bar, no spacer.
  if (!current) return null;

  const duration =
    player.duration > 0 ? player.duration : current.durationSeconds ?? 0;
  const playedFraction =
    dragFraction !== null
      ? dragFraction
      : duration > 0
        ? clamp01(clock / duration)
        : 0;
  const pct = `${playedFraction * 100}%`;
  const redGlow = "0 0 10px color-mix(in srgb, var(--cert-red) 70%, transparent)";

  // ⏭ is live on the last track only when repeat-all is set (it wraps to the top).
  const canSkipNext =
    player.index < player.queue.length - 1 || player.repeatMode === "all";
  const repeatLabel =
    player.repeatMode === "one"
      ? "Repeat one"
      : player.repeatMode === "all"
        ? "Repeat all"
        : "Repeat off";
  const contributorNames = current.contributors.map((c) => c.name).join(" · ");

  function fractionFromClientX(clientX: number): number {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp01((clientX - rect.left) / rect.width);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!duration) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = fractionFromClientX(e.clientX);
    setDragFraction(f);
    player.seek(f);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragFraction === null) return;
    const f = fractionFromClientX(e.clientX);
    setDragFraction(f);
    player.seek(f);
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
    if (!duration) return;
    const step = 5;
    let nextTime: number | null = null;
    if (e.key === "ArrowRight") nextTime = Math.min(duration, clock + step);
    else if (e.key === "ArrowLeft") nextTime = Math.max(0, clock - step);
    else if (e.key === "Home") nextTime = 0;
    else if (e.key === "End") nextTime = duration;
    if (nextTime !== null) {
      e.preventDefault();
      player.seekToTime(nextTime);
    }
  }

  return (
    <>
      {/* Reserve the bar's height (incl. iOS safe area) so nothing hides behind
          the fixed element below. */}
      <div aria-hidden className="h-[calc(4.75rem+env(safe-area-inset-bottom))]" />

      <aside
        aria-label="Now playing"
        className="fixed inset-x-0 bottom-0 z-30 flex flex-col border-t border-white/10 bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        {/* The Red Line: a thin scrub bar across the top of the now-playing bar. */}
        <div
          ref={barRef}
          role="slider"
          tabIndex={0}
          aria-label={`Seek ${current.title}`}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration) || 0}
          aria-valuenow={Math.round(playedFraction * duration)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className="group relative flex h-3 cursor-pointer touch-none select-none items-center focus-visible:outline-none"
        >
          <div className="relative h-[3px] w-full bg-cert-red/15 group-focus-visible:bg-cert-red/25">
            <div
              className="absolute inset-y-0 left-0 bg-cert-red"
              style={{ width: pct, boxShadow: redGlow }}
            />
          </div>
        </div>

        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4">
          <Link
            href={`/registry/${current.id}`}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition hover:opacity-90"
            aria-label={`Open AIRED-${current.id} ${current.title}`}
          >
            {current.artworkUrl ? (
              <Image
                src={current.artworkUrl}
                alt=""
                width={48}
                height={48}
                unoptimized
                className="size-12 shrink-0 rounded-md border border-white/10 object-cover"
              />
            ) : (
              <span className="flex size-12 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-[9px] uppercase tracking-[0.14em] text-muted/50">
                no art
              </span>
            )}
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-medium text-foreground">
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-cert-red">
                  {formatCatalogId(current.id)}
                </span>
                <span className="text-muted/50"> · </span>
                {current.title}
              </span>
              {contributorNames ? (
                <span className="truncate text-[11px] text-muted">
                  {contributorNames}
                </span>
              ) : null}
            </span>
          </Link>

          <div className="flex shrink-0 items-center gap-1">
            {current.hlsPlaylistKey ? (
              <DownloadButton
                variant="compact"
                input={{
                  id: current.id,
                  title: current.title,
                  hlsPlaylistKey: current.hlsPlaylistKey,
                  artworkUrl: current.artworkUrl,
                  durationSeconds: current.durationSeconds,
                  lyrics: null,
                  contributors: current.contributors,
                }}
              />
            ) : null}
            <button
              type="button"
              onClick={player.prev}
              aria-label="Previous track"
              className="flex size-9 items-center justify-center rounded-full text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50"
            >
              <PrevIcon />
            </button>
            <button
              type="button"
              onClick={player.toggle}
              aria-label={player.isPlaying ? "Pause" : "Play"}
              className="flex size-10 items-center justify-center rounded-full bg-cert-red text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50"
            >
              {player.buffering ? (
                <span className="size-2 rounded-full bg-white motion-safe:animate-pulse" />
              ) : player.isPlaying ? (
                <PauseIcon />
              ) : (
                <PlayIcon />
              )}
            </button>
            <button
              type="button"
              onClick={player.next}
              disabled={!canSkipNext}
              aria-label="Next track"
              className="flex size-9 items-center justify-center rounded-full text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 disabled:opacity-30"
            >
              <NextIcon />
            </button>
            <button
              type="button"
              onClick={player.cycleRepeatMode}
              aria-label={repeatLabel}
              aria-pressed={player.repeatMode !== "off"}
              title={repeatLabel}
              className={`relative flex size-9 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 ${
                player.repeatMode === "off"
                  ? "text-muted hover:text-foreground"
                  : "text-cert-red hover:brightness-110"
              }`}
            >
              <RepeatIcon />
              {player.repeatMode === "one" ? (
                <span
                  aria-hidden
                  className="absolute bottom-0.5 right-0.5 flex size-3 items-center justify-center rounded-full bg-cert-red text-[8px] font-bold leading-none text-white"
                >
                  1
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </aside>
    </>
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

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M7 6a1 1 0 0 1 2 0v5l8.4-5.6A1 1 0 0 1 19 6.2v11.6a1 1 0 0 1-1.6.8L9 13v5a1 1 0 0 1-2 0V6Z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M17 6a1 1 0 0 0-2 0v5L6.6 5.4A1 1 0 0 0 5 6.2v11.6a1 1 0 0 0 1.6.8L15 13v5a1 1 0 0 0 2 0V6Z" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}
