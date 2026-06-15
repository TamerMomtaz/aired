"use client";

import { useEffect, useRef, useState } from "react";

import { formatDuration } from "@/lib/format";

// The Red Line made kinetic (CLAUDE.md §3): a custom HLS player whose progress
// bar IS the brand mark — cert-red on near-black, scrub-to-seek. Reusable as-is
// on agent / discography pages in Phase 5.
//
// Audio is served only from R2 via CDN (Rule 6). The base lives in an env var so
// the later cdn.ai-red.io swap needs no code change. NEXT_PUBLIC_ is inlined at
// build time, so changing it in Vercel requires a redeploy to take effect.
const R2_BASE = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE ?? "").replace(
  /\/+$/,
  "",
);

// Join the public base and the playlist key with exactly one slash.
function buildStreamUrl(key: string | null | undefined): string | null {
  if (!key || !key.trim()) return null;
  if (!R2_BASE) return null;
  return `${R2_BASE}/${key.trim().replace(/^\/+/, "")}`;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function RedLinePlayer({
  hlsPlaylistKey,
  workId,
  title,
  onTimeUpdate,
  onReady,
}: {
  hlsPlaylistKey: string | null | undefined;
  workId: number | bigint;
  title: string;
  // Optional observers (Phase 4 synced lyrics). When omitted the player behaves
  // exactly as before — these are the only additions to its public surface.
  onTimeUpdate?: (seconds: number) => void;
  onReady?: (durationSeconds: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  // hls.js instance is loaded dynamically (browser-only), so it has no type here.
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // While scrubbing, the bar follows the pointer immediately (0..1, else null).
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  // Bumping this re-runs setup — the "Try again" path after a load error.
  const [attempt, setAttempt] = useState(0);

  const streamUrl = buildStreamUrl(hlsPlaylistKey);
  const hasKey = !!(hlsPlaylistKey && hlsPlaylistKey.trim());

  // Hold the latest optional callbacks in refs so the playback-listener effect
  // below never re-subscribes when the parent passes a new function identity —
  // its deps stay [streamUrl], leaving audio/hls.js/seeking untouched. Absent
  // props make the calls no-ops, so behavior is byte-for-byte identical.
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
    onReadyRef.current = onReady;
  }, [onTimeUpdate, onReady]);

  // Attach the audio source: hls.js where supported, native HLS otherwise.
  useEffect(() => {
    const audio = audioRef.current;
    const url = buildStreamUrl(hlsPlaylistKey);
    if (!audio || !url) return;

    setLoadError(false);
    let cancelled = false;

    async function attach(url: string, el: HTMLAudioElement) {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;

      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error("[RedLinePlayer] fatal HLS error", data);
            setLoadError(true);
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
          }
        });
      } else if (el.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS play HLS natively from the element source.
        el.src = url;
      } else {
        console.error("[RedLinePlayer] HLS is not supported in this browser");
        setLoadError(true);
      }
    }

    attach(url, audio);

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      audio.removeAttribute("src");
      audio.load();
    };
  }, [hlsPlaylistKey, attempt]);

  // Mirror the element's playback state into React for the custom controls.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;

    const onTime = () => {
      setCurrentTime(audio.currentTime);
      onTimeUpdateRef.current?.(audio.currentTime);
    };
    const onDuration = () => {
      const next = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDuration(next);
      onReadyRef.current?.(next);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      setBuffering(false);
      setIsPlaying(true);
    };
    const onCanPlay = () => setBuffering(false);
    const onEnded = () => setIsPlaying(false);
    const onError = () => {
      console.error("[RedLinePlayer] audio element error", audio.error);
      setLoadError(true);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDuration);
    audio.addEventListener("loadedmetadata", onDuration);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDuration);
      audio.removeEventListener("loadedmetadata", onDuration);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [streamUrl]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch((err) => {
        console.error("[RedLinePlayer] play() failed", err);
      });
    } else {
      audio.pause();
    }
  }

  // --- Seeking: click or drag anywhere on the Red Line ---------------------
  function fractionFromClientX(clientX: number): number {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return clamp01((clientX - rect.left) / rect.width);
  }

  function seekToFraction(fraction: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }
    audio.currentTime = fraction * audio.duration;
    setCurrentTime(audio.currentTime);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!duration) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const fraction = fractionFromClientX(e.clientX);
    setDragFraction(fraction);
    seekToFraction(fraction);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragFraction === null) return;
    const fraction = fractionFromClientX(e.clientX);
    setDragFraction(fraction);
    seekToFraction(fraction); // VOD seeks smoothly; the bar tracks the finger
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (dragFraction === null) return;
    seekToFraction(fractionFromClientX(e.clientX));
    setDragFraction(null);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture may already be gone — ignore
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (!duration) return;
    const step = 5;
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(duration, audio.currentTime + step);
    else if (e.key === "ArrowLeft") next = Math.max(0, audio.currentTime - step);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = duration;
    if (next !== null) {
      e.preventDefault();
      audio.currentTime = next;
      setCurrentTime(next);
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
      <audio ref={audioRef} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
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
              onClick={() => {
                setLoadError(false);
                setAttempt((n) => n + 1);
              }}
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
