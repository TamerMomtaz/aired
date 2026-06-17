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
import { recordPlay } from "@/lib/plays/actions";
import { buildStreamUrl } from "@/lib/stream-url";

// When does a listen count? Once the track has been ACTUALLY listened to (not
// merely seeked past) for ~15 seconds, OR 25% of a short track — whichever comes
// first. Server-side recording + per-(session, hour) dedup live in src/lib/plays.
const PLAY_THRESHOLD_SECONDS = 15;
const PLAY_THRESHOLD_FRACTION = 0.25;
// localStorage key for the anonymous, PII-free listen session id. Persisted so a
// reload reuses it and the per-hour dedup holds across reloads.
const PLAY_SESSION_KEY = "aired_play_sid";

function makeSessionId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // crypto unavailable — fall through to the non-crypto id below.
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

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
  // How the queue loops: stop, wrap to the top, or replay the current track.
  repeatMode: RepeatMode;
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
  // Cycle the repeat mode: off → all → one → off.
  cycleRepeatMode: () => void;
};

// Repeat behavior for the session queue. "off" stops after the last track, "all"
// wraps back to the top of the queue, "one" loops the current track.
export type RepeatMode = "off" | "all" | "one";

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
  // Queue loop mode. Default off: the queue stops after the last track.
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");

  const current = useMemo(
    () => (index >= 0 && index < queue.length ? queue[index] : null),
    [queue, index],
  );

  // Mirror the queue into refs so the stable callbacks below read fresh values
  // without being re-created (which would re-subscribe the one-time listeners).
  const queueRef = useRef(queue);
  const indexRef = useRef(index);
  const repeatModeRef = useRef(repeatMode);
  useEffect(() => {
    queueRef.current = queue;
    indexRef.current = index;
    repeatModeRef.current = repeatMode;
  }, [queue, index, repeatMode]);

  // ---- play-count recording (real listens) --------------------------------
  // The anonymous listen session id (set once on mount, browser-only).
  const sessionIdRef = useRef<string | null>(null);
  // The work currently loaded, and per-load accounting for the threshold trigger:
  // `listenedRef` accumulates only actual playback time (seek jumps and pauses
  // don't count), and `playRecordedRef` makes us fire at most once per loaded
  // track. All three reset whenever the current track changes (effect below).
  const currentIdRef = useRef<number | null>(null);
  const listenedRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);
  const playRecordedRef = useRef(false);

  // Mint (or reuse) the anonymous listen session id once, on the client. No PII;
  // persisted so the per-hour play dedup survives reloads. localStorage may throw
  // (private mode) — fall back to a volatile id for the tab.
  useEffect(() => {
    try {
      let sid = window.localStorage.getItem(PLAY_SESSION_KEY);
      if (!sid) {
        sid = makeSessionId();
        window.localStorage.setItem(PLAY_SESSION_KEY, sid);
      }
      sessionIdRef.current = sid;
    } catch {
      sessionIdRef.current = sessionIdRef.current ?? makeSessionId();
    }
  }, []);

  // A new track is loaded: reset the per-track play accounting so the next listen
  // is measured (and recorded) on its own. Repeat-one replays the same `current`
  // without a reset, so a loop won't re-record — and the RPC would dedup it anyway.
  useEffect(() => {
    currentIdRef.current = current?.id ?? null;
    listenedRef.current = 0;
    lastTimeRef.current = null;
    playRecordedRef.current = false;
  }, [current]);

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

  // Restart the current track from the top and play. Used by repeat-one, and by
  // repeat-all when the queue is a single track — there the target index equals
  // the current one, so the attach effect won't re-run and can't replay on its own.
  const restartCurrent = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    audio.play().catch(() => {});
  }, []);

  const next = useCallback(() => {
    const i = indexRef.current;
    const q = queueRef.current;
    if (i < 0 || q.length === 0) return;

    // Where does ⏭ / auto-advance land? The next track, or — under repeat-all —
    // wrap to the top. Under repeat-off at the last track there's nowhere to go.
    let target: number | null;
    if (i + 1 < q.length) target = i + 1;
    else if (repeatModeRef.current === "all") target = 0;
    else target = null;

    if (target === null) {
      // End of the queue — stop. A natural `ended` doesn't fire a `pause` event,
      // so settle the play state explicitly.
      audioRef.current?.pause();
      setIsPlaying(false);
    } else if (target === i) {
      // Single-track repeat-all: same index, so the source won't re-attach.
      restartCurrent();
    } else {
      pendingPlayRef.current = true;
      setIndex(target);
    }
  }, [restartCurrent]);

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

  const cycleRepeatMode = useCallback(() => {
    setRepeatMode((m) => (m === "off" ? "all" : m === "all" ? "one" : "off"));
  }, []);

  // The element's `ended`: repeat-one replays the current track in place without
  // advancing; every other mode hands off to next() (which stops, advances, or
  // wraps to the top depending on the mode).
  const handleEnded = useCallback(() => {
    if (repeatModeRef.current === "one") {
      restartCurrent();
      return;
    }
    next();
  }, [next, restartCurrent]);

  // The element fires `ended` from a listener bound once (below); route it through
  // a ref so it always calls the latest handler.
  const endedRef = useRef(handleEnded);
  useEffect(() => {
    endedRef.current = handleEnded;
  }, [handleEnded]);

  // ---- element listeners: bound once (the <audio> never unmounts) ----------
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => {
      const t = audio.currentTime;
      setCurrentTime(t);

      // Accumulate ACTUAL listened time so a real listen — not a scrub or a
      // background tab — is what crosses the threshold. Count only small forward
      // steps (normal playback ticks ~4×/s); ignore backward/large jumps (seeks)
      // and anything while paused.
      const last = lastTimeRef.current;
      if (last !== null && !audio.paused) {
        const delta = t - last;
        if (delta > 0 && delta < 1.5) listenedRef.current += delta;
      }
      lastTimeRef.current = t;

      // Record one honest play once enough has actually been heard. Fire-and-
      // forget; the RPC dedups per (session, work, hour), so this is safe even if
      // it slips through twice. At most once per loaded track (the ref guard).
      if (playRecordedRef.current) return;
      const workId = currentIdRef.current;
      const sid = sessionIdRef.current;
      if (workId === null || !sid) return;
      const dur =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : null;
      const threshold = dur
        ? Math.min(PLAY_THRESHOLD_SECONDS, dur * PLAY_THRESHOLD_FRACTION)
        : PLAY_THRESHOLD_SECONDS;
      if (listenedRef.current >= threshold) {
        playRecordedRef.current = true;
        void recordPlay(workId, sid).catch(() => {});
      }
    };
    const onDuration = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => {
      setIsPlaying(true);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
      }
    };
    const onPause = () => {
      setIsPlaying(false);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
    };
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

  // ---- OS media session: lock-screen + headphone controls (PWA) -----------
  // Action handlers are wired once (the callbacks are stable). The metadata —
  // title, the contributors as the "artist" line (public & celebrated, §3a),
  // artwork — updates whenever the current track changes.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    const ms = navigator.mediaSession;
    ms.setActionHandler("play", () => play());
    ms.setActionHandler("pause", () => pause());
    ms.setActionHandler("previoustrack", () => prev());
    ms.setActionHandler("nexttrack", () => next());
    ms.setActionHandler("seekto", (e) => {
      if (typeof e.seekTime === "number") seekToTime(e.seekTime);
    });
    return () => {
      ms.setActionHandler("play", null);
      ms.setActionHandler("pause", null);
      ms.setActionHandler("previoustrack", null);
      ms.setActionHandler("nexttrack", null);
      ms.setActionHandler("seekto", null);
    };
  }, [play, pause, prev, next, seekToTime]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    if (!current) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.title,
      artist: current.contributors.map((c) => c.name).join(", "),
      album: "AIRED",
      artwork: current.artworkUrl
        ? [{ src: current.artworkUrl, sizes: "512x512" }]
        : [],
    });
  }, [current]);

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
      repeatMode,
      playQueue,
      toggle,
      play,
      pause,
      next,
      prev,
      seek,
      seekToTime,
      retry,
      cycleRepeatMode,
    }),
    [
      queue,
      index,
      current,
      isPlaying,
      duration,
      buffering,
      loadError,
      repeatMode,
      playQueue,
      toggle,
      play,
      pause,
      next,
      prev,
      seek,
      seekToTime,
      retry,
      cycleRepeatMode,
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
