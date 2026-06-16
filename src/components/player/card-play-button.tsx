"use client";

import { usePlayer } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";

// The play affordance on a feed card's cover. Tapping it starts the whole feed
// as a queue from this card and KEEPS the listener browsing (the bar takes over);
// tapping the art or title instead navigates to the song page. It lives OUTSIDE
// the card's <Link> so there are no nested anchors.
export function CardPlayButton({
  queue,
  workId,
  title,
}: {
  queue: Track[];
  workId: number;
  title: string;
}) {
  const player = usePlayer();
  const isCurrent = player.current?.id === workId;
  const isThisPlaying = isCurrent && player.isPlaying;

  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (isCurrent) {
      player.toggle();
      return;
    }
    const index = queue.findIndex((t) => t.id === workId);
    if (index >= 0) player.playQueue(queue, index);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isThisPlaying ? `Pause ${title}` : `Play ${title}`}
      aria-pressed={isThisPlaying}
      className="absolute bottom-2 right-2 flex size-10 items-center justify-center rounded-full bg-cert-red/95 text-white shadow-[0_0_18px_-4px_var(--cert-red)] backdrop-blur transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      {isThisPlaying ? <PauseIcon /> : <PlayIcon />}
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
