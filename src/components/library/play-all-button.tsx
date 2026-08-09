"use client";

import { usePlayer } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";

// Start a whole shelf — the Adorned run, or one mood — from the top. While that
// shelf is the thing playing, the button becomes the pause control for it, so a
// listener is never offered "play" over sound that is already going.
export function PlayAllButton({
  queue,
  label = "Play all",
}: {
  queue: Track[];
  label?: string;
}) {
  const player = usePlayer();

  // "This shelf is what's loaded" is judged by the current track being one of
  // ours — cheap, and true through the shelf's own auto-advance.
  const isThisShelf =
    player.current !== null && queue.some((t) => t.id === player.current?.id);
  const isPlaying = isThisShelf && player.isPlaying;

  if (queue.length === 0) return null;

  return (
    <button
      type="button"
      onClick={() => (isThisShelf ? player.toggle() : player.playQueue(queue, 0))}
      className="inline-flex items-center gap-2 rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50"
    >
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
      {isPlaying ? "Pause" : label}
    </button>
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
