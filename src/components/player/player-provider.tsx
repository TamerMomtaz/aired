"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Track } from "@/components/player/track";
import { buildStreamUrl } from "@/lib/stream-url";

// The single global audio engine. There is exactly ONE <audio> element in the
// whole app and it lives here, in a provider that wraps the persistent app shell
// — so sound survives navigation, auto-advances at song end, and keeps playing
// while the listener browses. This is the Phase 5 "radio plays continuously"
// foundation (CLAUDE.md §5). Session queue only: no DB playlist table.
//
// The owner tap-sync lyrics editor keeps its OWN private <audio> on purpose — a
// separate, intentional engine for stamping line times. Nothing else may create
// an audio element.

type PlayerContextValue = {
  // The session queue and where we are in it. `current` is the playing/loaded
  // track, or null when the queue is empty (nothing has been played yet).
  queue: Track[];
  index: number;
  current: Track | null;
  // Transport state mirrored from the element (currentTime is split out into its
  // own context below so the ~4×/second tick doesn't re-render the whole app).
  isPlaying: boolean;
  duration: number;
  buffering: boolean;
  loadError: boolean;
  // Actions.
  playQueue: (tracks: Track[], startIndex: number) => void;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (fraction: number) => void;
  seekToTime: (seconds: number) => void;
  retry: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);
// currentTime ticks several times a second; isolating it means only the handful
// of components that actually render a clock (the page player, the now-playing
// bar, the lyrics) re-render on each update — not every work card on the feed.
const PlayerClockContext = createContext<number>(0);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error("usePlayer must be used within <PlayerProvider>");
  }
  return ctx;
}

export function usePlayerClock(): number {
  return useContext(PlayerClockContext);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // hls.js is loaded dynamically (browser-only), so it carries no type here.
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Bumping this re-runs the attach effect — the "Try again" path after an error.
  const [attempt, setAttempt] = useState(0);

  const current = useMemo(
    () => (index >= 0 && index < queue.length ? queue[index] : null),
    [queue, index],
  );

  // Mirror the queue into refs so the stable callbacks below read fresh values
  // without being re-created (which would re-subscribe the one-time listeners).
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  useEffect(() => {
    queueRef.current = queue;
    indexRef.current = index;
  }, [queue, index]);

  // When true, the element should start playing as soon as it's ready — set by
  // user-initiated playQueue and by the auto-advance in next()/prev().
  const pendingPlayRef = useRef(false);
  // The URL currently attached, so playing the already-current track resumes
  // instead of needlessly tearing down and re-attaching the source.
  const lastUrlRef = useRef<string | null>(null);

  const currentUrl = buildStreamUrl(current?.hlsPlaylistKey);

  // ---- transport actions (all stable) -------------------------------------
  const play = useCallback(() => {
    audioRef.current?.play().catch(() => {});
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seekToTime = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }
    audio.currentTime = clamp(seconds, 0, audio.duration);
    setCurrentTime(audio.currentTime);
  }, []);

  const seek = useCallback(
    (fraction: number) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
        return;
      }
      seekToTime(fraction * audio.duration);
    },
    [seekToTime],
  );

  const playQueue = useCallback((tracks: Track[], startIndex: number) => {
    if (tracks.length === 0) return;
    const i = clamp(startIndex, 0, tracks.length - 1);
    const targetUrl = buildStreamUrl(tracks[i].hlsPlaylistKey);
    pendingPlayRef.current = true;
    setQueue(tracks);
    setIndex(i);
    // Tapping play on the track that's already loaded: the attach effect won't
    // re-run (same URL), so kick playback directly here.
    if (targetUrl && targetUrl === lastUrlRef.current) {
      pendingPlayRef.current = false;
      audioRef.current?.play().catch(() => {});
    }
  }, []);

  const next = useCallback(() => {
    const i = indexRef.current;
    const q = queueRef.current;
    if (i >= 0 && i + 1 < q.length) {
      pendingPlayRef.current = true;
      setIndex(i + 1);
    } else {
      // End of the queue — stop. No loop in v1.
      audioRef.current?.pause();
    }
  }, []);

  const prev = useCallback(() => {
    const audio = audioRef.current;
    // Standard player feel: restart the current track if we're a few seconds in,
    // otherwise step back one track.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const i = indexRef.current;
    if (i > 0) {
      pendingPlayRef.current = true;
      setIndex(i - 1);
    } else if (audio) {
      audio.currentTime = 0;
      setCurrentTime(0);
    }
  }, []);

  const retry = useCallback(() => {
    setLoadError(false);
    setAttempt((n) => n + 1);
  }, []);

  // The element fires `ended` from a listener bound once (below); route it through
  // a ref so it always calls the latest next().
  const endedRef = useRef(next);
  useEffect(() => {
    endedRef.current = next;
  }, [next]);

  // ---- element listeners: bound once (the <audio> never unmounts) ----------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onDuration = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => {
      setBuffering(false);
      setIsPlaying(true);
    };
    const onCanPlay = () => {
      setBuffering(false);
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        audio.play().catch(() => {});
      }
    };
    // A new source begins loading: clear any stale error and reset the clock.
    // Doing this here (an element event) — rather than synchronously in the
    // attach effect — keeps the element the single source of truth.
    const onLoadStart = () => {
      setBuffering(true);
      setLoadError(false);
      setCurrentTime(0);
    };
    const onEmptied = () => {
      setBuffering(false);
      setCurrentTime(0);
      setDuration(0);
    };
    const onEnded = () => endedRef.current();
    const onError = () => {
      console.error("[player] audio element error", audio.error);
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
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("emptied", onEmptied);
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
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("emptied", onEmptied);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  // ---- attach the current track's source: hls.js, or native HLS on Safari ---
  // Resets (buffering / error / clock) are handled by the element's loadstart &
  // emptied events above — this effect only touches the DOM and hls.js, so it
  // never calls setState synchronously during render.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Tear down any previous source first.
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    lastUrlRef.current = currentUrl;

    if (!currentUrl) {
      audio.removeAttribute("src");
      audio.load(); // fires "emptied" → resets the clock
      return;
    }

    let cancelled = false;

    (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;

      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(currentUrl);
        hls.attachMedia(audio);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.error("[player] fatal HLS error", data);
            setLoadError(true);
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
          }
        });
      } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS play HLS natively from the element source.
        audio.src = currentUrl;
      } else {
        console.error("[player] HLS is not supported in this browser");
        setLoadError(true);
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [currentUrl, attempt]);

  // The stable half of the API. Memoized so its identity changes only when these
  // values actually change — NOT on every currentTime tick — keeping non-clock
  // consumers (e.g. feed cards) from re-rendering several times a second.
  const value = useMemo<PlayerContextValue>(
    () => ({
      queue,
      index,
      current,
      isPlaying,
      duration,
      buffering,
      loadError,
      playQueue,
      toggle,
      play,
      pause,
      next,
      prev,
      seek,
      seekToTime,
      retry,
    }),
    [
      queue,
      index,
      current,
      isPlaying,
      duration,
      buffering,
      loadError,
      playQueue,
      toggle,
      play,
      pause,
      next,
      prev,
      seek,
      seekToTime,
      retry,
    ],
  );

  return (
    <PlayerContext.Provider value={value}>
      <PlayerClockContext.Provider value={currentTime}>
        {children}
      </PlayerClockContext.Provider>
      <audio ref={audioRef} preload="metadata" />
    </PlayerContext.Provider>
  );
}
