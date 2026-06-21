"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";

import { usePlayer } from "@/components/player/player-provider";
import { formatCatalogId } from "@/lib/catalog";
import { formatDuration } from "@/lib/format";
import {
  clearAllDownloads,
  deleteDownload,
  trackFromSnapshot,
  useDownloads,
  useOnline,
  useStorageEstimate,
} from "@/lib/offline/store";

// The Downloads screen. It renders ENTIRELY from the IndexedDB snapshots — never
// the database — so it works with the network fully off. Each row plays through
// the one global player (the service worker feeds hls.js the cached segments) and
// can be removed to free space. This is the calm place the app points to when
// you're offline.

export function DownloadsScreen() {
  const { snapshots, hydrated } = useDownloads();
  const online = useOnline();
  const estimate = useStorageEstimate(snapshots);
  const player = usePlayer();
  const [confirmClear, setConfirmClear] = useState(false);

  // The whole library as one play queue, in download order — "downloads radio".
  const tracks = useMemo(() => snapshots.map(trackFromSnapshot), [snapshots]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Downloads</h1>
        <p className="text-sm text-muted">
          Songs kept on this device — they play with no connection. Stored only
          here, on your device.
        </p>
      </header>

      {!online ? (
        <p className="rounded-lg border border-cert-red/30 bg-cert-red/[0.06] px-4 py-3 text-sm text-foreground">
          You&apos;re offline — here are your downloads. They play start to
          finish from this device.
        </p>
      ) : null}

      {/* Storage readout + clear-all. */}
      {snapshots.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">
              {snapshots.length} song{snapshots.length === 1 ? "" : "s"} ·{" "}
              {formatBytes(librarySize(snapshots))} on this device
            </span>
            {confirmClear ? (
              <span className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmClear(false);
                    void clearAllDownloads();
                  }}
                  className="rounded-md border border-cert-red/50 px-2.5 py-1 text-xs font-medium text-cert-red transition hover:bg-cert-red/10"
                >
                  Remove all
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded-md px-2 py-1 text-xs text-muted transition hover:text-foreground"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="shrink-0 rounded-md border border-white/12 px-2.5 py-1 text-xs text-muted transition hover:border-white/25 hover:text-foreground"
              >
                Remove all
              </button>
            )}
          </div>
          {estimate && estimate.quota > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full bg-cert-red/70"
                  style={{
                    width: `${Math.min(100, (estimate.usage / estimate.quota) * 100)}%`,
                  }}
                />
              </div>
              <span className="font-mono text-[11px] text-muted/60">
                {formatBytes(estimate.usage)} of {formatBytes(estimate.quota)}{" "}
                used on this device
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The list, or an empty / loading state. */}
      {snapshots.length > 0 ? (
        <ul className="flex flex-col divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8">
          {snapshots.map((snap, i) => {
            const isCurrent = player.current?.id === snap.id;
            const isPlaying = isCurrent && player.isPlaying;
            const names = snap.contributors.map((c) => c.name).join(" · ");
            return (
              <li
                key={snap.id}
                className="flex items-center gap-3 px-3 py-3 transition hover:bg-white/[0.03]"
              >
                <button
                  type="button"
                  onClick={() =>
                    isCurrent ? player.toggle() : player.playQueue(tracks, i)
                  }
                  aria-label={
                    isPlaying
                      ? `Pause ${snap.title}`
                      : `Play ${snap.title}`
                  }
                  className="group relative size-14 shrink-0 overflow-hidden rounded-md border border-white/10"
                >
                  {snap.artworkUrl ? (
                    <Image
                      src={snap.artworkUrl}
                      alt=""
                      fill
                      sizes="56px"
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-white/[0.04] text-[8px] uppercase tracking-[0.14em] text-muted/50">
                      no art
                    </span>
                  )}
                  <span
                    className={`absolute inset-0 flex items-center justify-center bg-background/40 text-white transition ${
                      isCurrent ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    {isPlaying ? <PauseGlyph /> : <PlayGlyph />}
                  </span>
                  {isCurrent ? (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-cert-red" />
                  ) : null}
                </button>

                <Link
                  href={`/registry/${snap.id}`}
                  className="flex min-w-0 flex-1 flex-col gap-0.5"
                >
                  <span className="truncate text-sm font-medium text-foreground">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-cert-red">
                      {formatCatalogId(snap.id)}
                    </span>
                    <span className="text-muted/50"> · </span>
                    {snap.title}
                  </span>
                  {names ? (
                    <span className="truncate text-[12px] text-muted">
                      {names}
                    </span>
                  ) : null}
                  <span className="font-mono text-[11px] text-muted/60">
                    {formatDuration(snap.durationSeconds)} ·{" "}
                    {formatBytes(snap.bytes)}
                  </span>
                </Link>

                <button
                  type="button"
                  onClick={() => void deleteDownload(snap.id)}
                  aria-label={`Remove ${snap.title} from downloads`}
                  title="Remove download"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-white/[0.05] hover:text-cert-red"
                >
                  <TrashGlyph />
                </button>
              </li>
            );
          })}
        </ul>
      ) : hydrated ? (
        <EmptyDownloads online={online} />
      ) : (
        <p className="rounded-xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-muted">
          Loading your downloads…
        </p>
      )}
    </div>
  );
}

function EmptyDownloads({ online }: { online: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-white/12 px-6 py-16 text-center">
      <span className="font-mono text-sm uppercase tracking-[0.18em] text-muted/60">
        nothing downloaded yet
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-muted">
        Tap <span className="text-foreground">Download</span> on any song and it
        lands here — ready to play with the network off, on a plane, anywhere.
      </p>
      {online ? (
        <Link
          href="/"
          className="rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
        >
          Find something to keep
        </Link>
      ) : null}
    </div>
  );
}

// Sum the per-song stored bytes (what AIRED added), distinct from whole-origin
// usage (which the estimate bar shows).
function librarySize(snaps: { bytes: number }[]): number {
  return snaps.reduce((sum, s) => sum + (s.bytes || 0), 0);
}

// Bytes → a short human size. KB under a MB, GB past a thousand MB.
function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "0 MB";
  const kb = n / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.5-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function TrashGlyph() {
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
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
