"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AdornButton } from "@/components/library/adorn-button";
import { usePlayer } from "@/components/player/player-provider";
import type { Track } from "@/components/player/track";
import { formatCatalogId } from "@/lib/catalog";
import { formatDuration } from "@/lib/format";
import { moveMoodItem, removeMoodItem } from "@/lib/library/actions";

// One mood, as a list you can play, reorder and prune.
//
// Reordering is up/down arrows rather than drag-and-drop: this platform is used
// on a phone first, where a drag fights the page's own scroll, and an arrow is
// one unambiguous tap. Each move is a server round trip that renumbers the whole
// run (see mood_move_item) — no clever local sorting that could disagree with
// what the database actually holds.

export type MoodSong = { itemId: string; track: Track };

export function MoodSongList({
  moodId,
  songs,
}: {
  moodId: string;
  songs: MoodSong[];
}) {
  const player = usePlayer();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only streamable songs can be queued; the rest still list (and can still be
  // removed), they just aren't playable yet.
  const queue = songs.map((s) => s.track).filter((t) => t.hlsPlaylistKey);

  function playFrom(track: Track) {
    if (!track.hlsPlaylistKey) return;
    if (player.current?.id === track.id) {
      player.toggle();
      return;
    }
    const index = queue.findIndex((t) => t.id === track.id);
    if (index >= 0) player.playQueue(queue, index);
  }

  async function move(itemId: string, direction: "up" | "down") {
    if (busyId) return;
    setBusyId(itemId);
    setError(null);
    const res = await moveMoodItem(itemId, direction, moodId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  async function remove(itemId: string) {
    if (busyId) return;
    setBusyId(itemId);
    setError(null);
    const res = await removeMoodItem(itemId, moodId);
    setBusyId(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-xs text-cert-red">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col divide-y divide-white/6 rounded-xl border border-white/8">
        {songs.map((song, i) => {
          const { track } = song;
          const isCurrent = player.current?.id === track.id;
          const isThisPlaying = isCurrent && player.isPlaying;
          const contributors = track.contributors.map((c) => c.name).join(" · ");
          const rowBusy = busyId === song.itemId;

          return (
            <li
              key={song.itemId}
              className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-white/[0.03]"
            >
              <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted/50">
                {i + 1}
              </span>

              <button
                type="button"
                onClick={() => playFrom(track)}
                disabled={!track.hlsPlaylistKey}
                aria-label={
                  isThisPlaying ? `Pause ${track.title}` : `Play ${track.title}`
                }
                className="relative size-11 shrink-0 overflow-hidden rounded-md border border-white/10 disabled:opacity-50"
              >
                {track.artworkUrl ? (
                  <Image
                    src={track.artworkUrl}
                    alt=""
                    fill
                    sizes="44px"
                    unoptimized
                    className="object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-white/[0.04] text-[8px] uppercase tracking-[0.14em] text-muted/50">
                    no art
                  </span>
                )}
                {/* The overlay fills the button, so hovering the button IS
                    hovering it. The song that's playing keeps it up always, so
                    the list always shows where the sound is. */}
                {track.hlsPlaylistKey ? (
                  <span
                    className={`absolute inset-0 flex items-center justify-center bg-black/45 text-white transition hover:opacity-100 ${
                      isCurrent ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    {isThisPlaying ? <PauseIcon /> : <PlayIcon />}
                  </span>
                ) : null}
              </button>

              <Link
                href={`/registry/${track.id}`}
                className="flex min-w-0 flex-1 flex-col leading-tight transition hover:opacity-90"
              >
                <span className="truncate text-sm text-foreground">
                  <span
                    className={`font-mono text-[11px] uppercase tracking-[0.14em] ${isCurrent ? "text-cert-red" : "text-muted/60"}`}
                  >
                    {formatCatalogId(track.id)}
                  </span>
                  <span className="text-muted/40"> · </span>
                  {track.title}
                </span>
                {contributors ? (
                  <span className="truncate text-[11px] text-muted">
                    {contributors}
                  </span>
                ) : null}
              </Link>

              {track.durationSeconds != null ? (
                <span className="hidden shrink-0 font-mono text-[11px] text-muted/50 sm:inline">
                  {formatDuration(track.durationSeconds)}
                </span>
              ) : null}

              <AdornButton workId={track.id} title={track.title} size="sm" />

              <div className="flex shrink-0 items-center">
                <button
                  type="button"
                  onClick={() => move(song.itemId, "up")}
                  disabled={i === 0 || rowBusy}
                  aria-label={`Move ${track.title} up`}
                  className="flex size-8 items-center justify-center rounded-md text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 disabled:opacity-25"
                >
                  <ChevronUpIcon />
                </button>
                <button
                  type="button"
                  onClick={() => move(song.itemId, "down")}
                  disabled={i === songs.length - 1 || rowBusy}
                  aria-label={`Move ${track.title} down`}
                  className="flex size-8 items-center justify-center rounded-md text-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 disabled:opacity-25"
                >
                  <ChevronDownIcon />
                </button>
                <button
                  type="button"
                  onClick={() => remove(song.itemId)}
                  disabled={rowBusy}
                  aria-label={`Remove ${track.title} from this mood`}
                  className="flex size-8 items-center justify-center rounded-md text-muted transition hover:text-cert-red focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cert-red/50 disabled:opacity-25"
                >
                  <MinusIcon />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
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

function ChevronUpIcon() {
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
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

function ChevronDownIcon() {
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
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[18px]"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M5 12h14" />
    </svg>
  );
}
