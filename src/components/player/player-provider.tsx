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
import { diag } from "@/lib/diagnostics/log";
import { probe } from "@/lib/diagnostics/probe";
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

// ---- surviving a sleep, a lock screen, a backgrounded tab ------------------
// A phone that sleeps mid-song suspends timers and kills in-flight segment
// fetches. hls.js retries, runs out, and raises a FATAL error. Left alone, that
// is the end of playback until the page is reloaded by hand — which was exactly
// the bug: sound stopped and only a refresh brought it back.
//
// So a fatal error is treated as a thing to recover from, not a thing to give up
// on. hls.js publishes the ladder: startLoad() re-fetches after a network
// failure, recoverMediaError() re-primes the decoder after a media failure. We
// climb it a bounded number of times — a genuinely dead stream must still be
// able to surface an error rather than retry forever.
const MAX_RECOVERIES = 6;
// Recoveries that stop for this long are considered a healed stream, and the
// budget resets. Without this, six scattered blips across an hour-long listen
// would spend the whole allowance.
const RECOVERY_RESET_MS = 60_000;
// After returning to the foreground, how long to let the element prove it's
// actually moving before concluding it's frozen and stepping in.
const RESUME_PROBE_MS = 1_500;
// While we believe sound should be playing, a clock that hasn't advanced for
// this long is a stall, even if no error was ever raised.
const STALL_MS = 12_000;
const WATCHDOG_INTERVAL_MS = 5_000;

// ---- the flight recorder's heartbeat --------------------------------------
// A timer that asks for nothing and fixes nothing — it only says "I ran, and
// here is the wall-clock time." Its value is entirely in the GAPS: this
// interval is asked to tick every 5s, so an entry that lands 60s after the last
// one is Chrome's background throttling caught in the act, and one that lands
// after several minutes is a frozen page. Deliberately NOT gated on
// visibility — unlike the watchdog above it, whose blindness while hidden is
// precisely what we are here to measure.
const HEARTBEAT_MS = 5_000;
// Log a heartbeat when it arrives this much later than asked. 1.75× is well
// outside ordinary timer jitter and well inside the 1-per-minute floor of
// intensive throttling, so it catches the first sign of slowdown.
const HEARTBEAT_LATE_RATIO = 1.75;
// Even when nothing changes, leave a pulse this often so a quiet stretch is
// visibly quiet rather than merely absent from the log.
const HEARTBEAT_PULSE_MS = 60_000;

// The queue lives in React state, so before this it died on any reload — the
// refresh that unstuck playback also lost the listener's place. Persisting a
// small snapshot means a reload (or a crash, or coming back tomorrow) restores
// the run and the position. It never auto-plays: sound is the listener's to
// start.
const PLAYER_STATE_KEY = "aired_player_state";
const PLAYER_STATE_VERSION = 1;
// Don't restore a snapshot older than this — coming back a week later to a
// half-finished song you don't remember is worse than a clean slate.
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Cap what we persist: a whole browsed catalog is a lot of localStorage, and the
// tail of a long queue is not what anyone comes back for.
const MAX_PERSISTED_TRACKS = 120;

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

// The snapshot written to localStorage: where the listener was, and in what.
type PersistedState = {
  v: number;
  savedAt: number;
  queue: Track[];
  index: number;
  time: number;
  repeatMode: RepeatMode;
};

function readPersistedState(): PersistedState | null {
  try {
    const raw = window.localStorage.getItem(PLAYER_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed?.v !== PLAYER_STATE_VERSION) return null;
    if (!Array.isArray(parsed.queue) || parsed.queue.length === 0) return null;
    if (Date.now() - parsed.savedAt > STATE_MAX_AGE_MS) return null;
    if (parsed.index < 0 || parsed.index >= parsed.queue.length) return null;
    return parsed;
  } catch {
    // Unreadable, unparseable, or storage denied (private mode) — start clean.
    return null;
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // hls.js is loaded dynamically (browser-only), so it carries no type here.
  // startLoad / recoverMediaError are the recovery ladder the error handler
  // climbs before it will accept that a stream is really gone.
  const hlsRef = useRef<{
    destroy: () => void;
    startLoad: (startPosition?: number) => void;
    recoverMediaError: () => void;
  } | null>(null);

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

  // ---- recovery state -------------------------------------------------------
  // Does the LISTENER want sound right now? Set only by deliberate acts — a tap
  // on play or pause, a lock-screen control, an auto-advance — and deliberately
  // NOT by the element's own `pause` event, because a phone suspending audio
  // fires exactly that event. Reading intent off the element would mean the
  // suspension that broke playback also erased the wish to recover it.
  const wantsPlayRef = useRef(false);
  // When the clock last actually moved, so a frozen stream can be told apart
  // from a paused one.
  const lastProgressAtRef = useRef(0);
  // Recovery budget, and when it was last spent (see MAX_RECOVERIES).
  const recoveriesRef = useRef(0);
  const lastRecoveryAtRef = useRef(0);
  // A position waiting to be restored — from a reload, or from re-attaching a
  // native-HLS source that had to be reloaded whole.
  const restoreTimeRef = useRef<number | null>(null);

  const currentUrl = buildStreamUrl(current?.hlsPlaylistKey);

  // ---- the flight recorder's view of this provider ------------------------
  // Everything the recorder needs that only lives in here: the element, the
  // listener's intent, the recovery budget, and whether hls.js is still alive.
  // Stable (refs only), so it never re-binds a listener.
  const snap = useCallback(
    () =>
      probe(audioRef.current, {
        wantsPlay: wantsPlayRef.current,
        recoveries: recoveriesRef.current,
        hls: !!hlsRef.current,
      }),
    [],
  );

  // Every play() in this file goes through here. Eight call sites used to end
  // in `.catch(() => {})` — a rejected play promise is the browser refusing to
  // make sound, which is exactly the failure being hunted, and it was being
  // thrown away unread. Behaviour is unchanged: the rejection is still
  // swallowed, it is simply written down first.
  const attemptPlay = useCallback(
    (audio: HTMLAudioElement | null | undefined, reason: string) => {
      if (!audio) return;
      diag("play-call", reason, snap());
      const p = audio.play() as Promise<void> | undefined;
      if (!p || typeof p.then !== "function") return;
      p.then(
        () => diag("play-ok", reason),
        (err: unknown) => {
          const name = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          diag("play-REJECTED", `${reason} · ${name}`, snap());
        },
      );
    },
    [snap],
  );

  // ---- transport actions (all stable) -------------------------------------
  const play = useCallback(() => {
    wantsPlayRef.current = true;
    attemptPlay(audioRef.current, "play()");
  }, [attemptPlay]);

  const pause = useCallback(() => {
    wantsPlayRef.current = false;
    diag("pause()", "listener asked for silence", snap());
    audioRef.current?.pause();
  }, [snap]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      wantsPlayRef.current = true;
      attemptPlay(audio, "toggle→play");
    } else {
      wantsPlayRef.current = false;
      diag("pause()", "toggle→pause", snap());
      audio.pause();
    }
  }, [attemptPlay, snap]);

  // Spend one unit of the recovery budget. False means it's exhausted and the
  // failure has earned the right to surface. A stream that has behaved for a
  // while earns its budget back, so a long listen isn't ended by six unrelated
  // blips spread across an hour.
  const spendRecovery = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastRecoveryAtRef.current > RECOVERY_RESET_MS) {
      recoveriesRef.current = 0;
    }
    if (recoveriesRef.current >= MAX_RECOVERIES) {
      diag("budget-EXHAUSTED", `${MAX_RECOVERIES} recoveries spent within ${RECOVERY_RESET_MS}ms`);
      return false;
    }
    recoveriesRef.current += 1;
    lastRecoveryAtRef.current = now;
    diag("budget-spend", `${recoveriesRef.current}/${MAX_RECOVERIES}`);
    return true;
  }, []);

  // Put a broken stream back together, in place, without losing the listener's
  // position. Two engines, two ladders:
  //   • hls.js — startLoad() re-opens the segment pipeline from where we are.
  //   • native HLS (Safari / iOS) — there is no hls.js to ask, so the element
  //     itself is reloaded and seeked back to the moment it froze.
  const recoverStream = useCallback(
    (reason: string) => {
      const audio = audioRef.current;
      if (!audio) {
        diag("recover-SKIP", `${reason} · no element`);
        return;
      }

      const hls = hlsRef.current;
      if (hls) {
        diag("recover", `${reason} · hls.startLoad()`, snap());
        hls.startLoad();
        if (wantsPlayRef.current) attemptPlay(audio, `recover:${reason}`);
        return;
      }

      // No hls.js instance. On Safari/iOS that is native HLS and reloading the
      // element is the right ladder. On Android it can also mean hls.js was
      // DESTROYED by an exhausted budget — in which case the element has no
      // src at all and this reload has nothing to reload. Worth telling apart
      // in the timeline, so record which it is.
      const hasSrc = !!audio.currentSrc || !!audio.getAttribute("src");
      diag(
        "recover",
        `${reason} · element.load()${hasSrc ? "" : " · NO SRC (hls destroyed?)"}`,
        snap(),
      );
      const at = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      restoreTimeRef.current = at > 0 ? at : null;
      audio.load();
      if (wantsPlayRef.current) attemptPlay(audio, `recover:${reason}`);
    },
    [attemptPlay, snap],
  );

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
    diag(
      "playQueue",
      `work=${tracks[i].id} "${tracks[i].title}" · ${i + 1}/${tracks.length}`,
    );
    pendingPlayRef.current = true;
    wantsPlayRef.current = true;
    // A deliberate new listen starts with a full recovery budget.
    recoveriesRef.current = 0;
    // Whatever was being restored belongs to the old track, not this one.
    restoreTimeRef.current = null;
    setQueue(tracks);
    setIndex(i);
    // Tapping play on the track that's already loaded: the attach effect won't
    // re-run (same URL), so kick playback directly here.
    if (targetUrl && targetUrl === lastUrlRef.current) {
      pendingPlayRef.current = false;
      attemptPlay(audioRef.current, "playQueue:same-track");
    }
  }, [attemptPlay]);

  // Restart the current track from the top and play. Used by repeat-one, and by
  // repeat-all when the queue is a single track — there the target index equals
  // the current one, so the attach effect won't re-run and can't replay on its own.
  const restartCurrent = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    wantsPlayRef.current = true;
    audio.currentTime = 0;
    setCurrentTime(0);
    attemptPlay(audio, "restartCurrent");
  }, [attemptPlay]);

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
      // so settle the play state explicitly. The run is over, so the wish for
      // sound ends with it: nothing here should be "recovered" later.
      diag("queue-end", "wantsPlay cleared — nothing will be recovered after this");
      wantsPlayRef.current = false;
      audioRef.current?.pause();
      setIsPlaying(false);
    } else if (target === i) {
      // Single-track repeat-all: same index, so the source won't re-attach.
      restartCurrent();
    } else {
      pendingPlayRef.current = true;
      wantsPlayRef.current = true;
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
      wantsPlayRef.current = true;
      setIndex(i - 1);
    } else if (audio) {
      audio.currentTime = 0;
      setCurrentTime(0);
    }
  }, []);

  const retry = useCallback(() => {
    diag("retry", "re-attaching source from scratch", snap());
    setLoadError(false);
    // A deliberate retry hands back a full recovery budget — the listener has
    // told us they think it's worth another go.
    recoveriesRef.current = 0;
    wantsPlayRef.current = true;
    // Come back to where the listener was, not to the top of the song.
    const audio = audioRef.current;
    const at = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    restoreTimeRef.current = at > 0 ? at : null;
    setAttempt((n) => n + 1);
  }, [snap]);

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
      // The clock moved, so the stream is alive: this is what the watchdog and
      // the on-resume probe measure staleness against.
      lastProgressAtRef.current = Date.now();

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
    const onDuration = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      // The moment a duration exists, a pending position can be honoured — this
      // is what lands a reload, or a reloaded native-HLS source, back where the
      // listener actually was.
      const at = restoreTimeRef.current;
      if (at !== null && Number.isFinite(audio.duration) && audio.duration > 0) {
        restoreTimeRef.current = null;
        try {
          audio.currentTime = clamp(at, 0, audio.duration);
          setCurrentTime(audio.currentTime);
        } catch {
          // Not seekable yet — losing a resume point is not worth an exception.
        }
      }
    };
    const onPlay = () => {
      diag("evt:play", undefined, snap());
      setIsPlaying(true);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
      }
    };
    const onPause = () => {
      // The element pausing while the listener still wants sound is the whole
      // bug in one line — the OS or the engine stopping playback nobody asked
      // to stop. Called out loudly so it can't be missed in the timeline.
      diag(
        wantsPlayRef.current ? "evt:pause-UNWANTED" : "evt:pause",
        undefined,
        snap(),
      );
      setIsPlaying(false);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "paused";
      }
    };
    const onWaiting = () => {
      // Buffer starvation: the playhead has caught up with the data. In a car
      // this is the tunnel, the handoff, the dead cell.
      diag("evt:waiting", "buffer starved", snap());
      setBuffering(true);
    };
    // The element gave up trying to fetch. Log-only — nothing in the player
    // acts on these, and adding a listener that only records changes nothing.
    const onStalled = () => diag("evt:stalled", undefined, snap());
    const onSuspend = () => diag("evt:suspend", undefined, snap());
    const onRateChange = () => diag("evt:ratechange", undefined, snap());
    const onPlaying = () => {
      diag("evt:playing", "sound flowing", snap());
      setBuffering(false);
      setIsPlaying(true);
      // Sound is flowing again: clear the error and mark progress so a recovery
      // that worked isn't immediately re-triggered by a stale timestamp.
      setLoadError(false);
      lastProgressAtRef.current = Date.now();
    };
    const onCanPlay = () => {
      diag("canplay", undefined, snap());
      setBuffering(false);
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        attemptPlay(audio, "canplay:pending");
      }
    };
    // A new source begins loading: clear any stale error and reset the clock.
    // Doing this here (an element event) — rather than synchronously in the
    // attach effect — keeps the element the single source of truth.
    const onLoadStart = () => {
      diag("evt:loadstart", undefined, snap());
      setBuffering(true);
      setLoadError(false);
      setCurrentTime(0);
    };
    const onEmptied = () => {
      diag("evt:emptied", undefined, snap());
      setBuffering(false);
      setCurrentTime(0);
      setDuration(0);
    };
    const onEnded = () => {
      diag("evt:ended", undefined, snap());
      endedRef.current();
    };
    const onError = () => {
      console.error("[player] audio element error", audio.error);
      diag(
        "evt:ERROR",
        `element · code=${audio.error?.code ?? "?"} ${audio.error?.message ?? ""}`,
        snap(),
      );
      // With hls.js attached, its own ERROR event owns the ladder — stepping in
      // here too would race it and burn the budget twice for one failure.
      if (hlsRef.current) return;
      // Native HLS (Safari / iOS): the element IS the engine, so recovery is the
      // element's to do — reload and seek back. This is the path Tee's iPhone
      // takes, and before this it had no recovery at all.
      if (!wantsPlayRef.current || !spendRecovery()) {
        diag("give-up", "element error, no budget or no intent", snap());
        setLoadError(true);
        return;
      }
      recoverStream("element-error");
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("stalled", onStalled);
    audio.addEventListener("suspend", onSuspend);
    audio.addEventListener("ratechange", onRateChange);
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
      audio.removeEventListener("stalled", onStalled);
      audio.removeEventListener("suspend", onSuspend);
      audio.removeEventListener("ratechange", onRateChange);
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
    // Every dependency here is a useCallback whose own deps are stable for the
    // life of the provider, so the listeners still bind exactly once.
  }, [recoverStream, spendRecovery, snap, attemptPlay]);

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
        diag("hls-attach", currentUrl, snap());
        // Record the buffer contract this device actually got, rather than the
        // one the defaults imply. hls.js sizes its forward buffer from the
        // LEVEL BITRATE (see getMaxBufferLength): with a bitrate it will hold
        // up to maxMaxBufferLength, and with none it falls back to the flat
        // maxBufferLength. AIRED serves a bare media playlist — no master, no
        // BANDWIDTH attribute — so the expectation is the fallback. This line
        // is how we confirm that from the car instead of from the source.
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          const c = hls.config;
          const bitrate = hls.levels?.[0]?.maxBitrate ?? 0;
          const target = bitrate
            ? Math.min(
                Math.max((8 * c.maxBufferSize) / bitrate, c.maxBufferLength),
                c.maxMaxBufferLength,
              )
            : c.maxBufferLength;
          diag(
            "hls-buffer-config",
            `levelBitrate=${bitrate} → forward target ${Math.round(target)}s ` +
              `(maxBufferLength=${c.maxBufferLength} maxMaxBufferLength=${c.maxMaxBufferLength} ` +
              `maxBufferSize=${c.maxBufferSize})`,
          );
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          // NON-FATAL ERRORS ARE THE BREADCRUMBS. The line below this used to
          // be the first statement in the handler, so every fragLoadError,
          // fragLoadTimeOut, bufferStalledError and bufferSeekOverHole was
          // dropped unread — and those are precisely the events that describe
          // a stream dying slowly in a tunnel. They still change nothing about
          // behaviour; now they are written down on the way past.
          diag(
            data.fatal ? "hls-FATAL" : "hls-warn",
            `${data.type} · ${data.details}${
              data.response?.code ? ` · http=${data.response.code}` : ""
            }${data.error?.message ? ` · ${data.error.message}` : ""}`,
            snap(),
          );
          if (!data.fatal) return;

          // THE BUG THIS FIXES: this branch used to call hls.destroy() and stop.
          // A backgrounded tab or a sleeping phone reliably produces a fatal
          // network error, so playback died on every screen timeout and only a
          // page reload brought it back.
          //
          // hls.js documents the way out, and it is not "give up":
          //   NETWORK_ERROR → startLoad() re-opens the segment pipeline.
          //   MEDIA_ERROR   → recoverMediaError() re-primes the decoder.
          // Anything else, or a budget spent, is a real failure worth showing.
          const recoverable =
            data.type === Hls.ErrorTypes.NETWORK_ERROR ||
            data.type === Hls.ErrorTypes.MEDIA_ERROR;

          if (!recoverable || !spendRecovery()) {
            console.error("[player] unrecoverable HLS error", data);
            // hls.destroy() here is a one-way door: the engine is gone, the
            // element loses its MSE source, and nothing short of re-attaching
            // (retry(), i.e. a listener tapping "Try again") can make sound
            // again. If the timeline ends here, that is why.
            diag(
              "give-up-DESTROY",
              `${recoverable ? "budget spent" : "unrecoverable"} · engine destroyed`,
              snap(),
            );
            setLoadError(true);
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
            return;
          }

          console.warn("[player] recovering from HLS error", data.type);
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            diag("recover", "hls-fatal · startLoad()", snap());
            hls.startLoad();
          } else {
            diag("recover", "hls-fatal · recoverMediaError()", snap());
            hls.recoverMediaError();
          }
          // The element is often left paused by the failure; if the listener
          // still wants sound, ask for it once the pipeline is reopened.
          if (wantsPlayRef.current) attemptPlay(audio, "hls-fatal-recover");
        });
      } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS play HLS natively from the element source.
        diag("native-hls-attach", currentUrl, snap());
        audio.src = currentUrl;
      } else {
        console.error("[player] HLS is not supported in this browser");
        diag("no-hls-support", currentUrl);
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
  }, [currentUrl, attempt, spendRecovery, snap, attemptPlay]);

  // ---- coming back: screen timeout, tab switch, app resume ----------------
  // Nothing in this provider used to notice the page leaving and returning, so
  // audio the OS suspended stayed suspended and the listener had to reload. Now
  // three things watch for it, all gated on wantsPlayRef — a listener who
  // deliberately paused is never surprised by sound restarting.
  //
  //   • visibilitychange / pageshow — the page is in front again.
  //   • the probe — give the element a moment to prove it's actually moving
  //     before intervening, so healthy playback is left alone.
  //   • the watchdog — catches a stall that happens while the page is open and
  //     visible, which no page event would ever announce.
  useEffect(() => {
    if (typeof document === "undefined") return;

    // Is the clock stuck? Only meaningful while we believe sound should play.
    const isStalled = (audio: HTMLAudioElement) =>
      wantsPlayRef.current &&
      !audio.ended &&
      Date.now() - lastProgressAtRef.current > STALL_MS;

    const nudge = () => {
      const audio = audioRef.current;
      if (!audio || !wantsPlayRef.current) return;

      // The element gave up outright: re-attach the source from scratch. The
      // attach effect re-runs on `attempt`, and retry() has already stored the
      // position to come back to.
      if (audio.error) {
        retry();
        return;
      }
      if (isStalled(audio)) {
        diag(
          "watchdog-STALL",
          `no progress for >${STALL_MS}ms`,
          snap(),
        );
        if (spendRecovery()) recoverStream("watchdog");
        else setLoadError(true);
        return;
      }
      // Not stalled, merely suspended — the common case after a screen timeout.
      if (audio.paused) attemptPlay(audio, "watchdog:resume-paused");
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        // The page LEAVING. From here until the matching return, the watchdog
        // below is switched off by its own visibility gate — so if the timeline
        // shows a failure after this line and no watchdog entry before the
        // return, the recovery ladder was never given a chance to run.
        diag("page-HIDDEN", "watchdog now blind", snap());
        return;
      }
      diag("page-visible", "watchdog live again", snap());
      const audio = audioRef.current;
      if (!audio || !wantsPlayRef.current) return;

      if (audio.error) {
        retry();
        return;
      }
      if (audio.paused) attemptPlay(audio, "onVisible:resume-paused");

      // Give it a beat, then judge by whether the clock actually moved. A tab
      // that was merely throttled resumes on its own and needs no help; one
      // whose stream died looks identical until you watch the clock.
      const before = audio.currentTime;
      window.setTimeout(() => {
        const a = audioRef.current;
        if (!a || !wantsPlayRef.current) return;
        if (document.visibilityState !== "visible") return;
        if (a.currentTime > before + 0.05) {
          diag("resume-probe", "clock moved — healthy", snap());
          return;
        }
        diag("resume-probe-FROZEN", `still at ${before.toFixed(1)}s`, snap());
        if (spendRecovery()) recoverStream("resume-probe");
      }, RESUME_PROBE_MS);
    };

    const onVisibility = () => onVisible();
    const onPageShow = () => {
      diag("evt:pageshow", undefined, snap());
      onVisible();
    };
    const onPageHide = () => diag("evt:pagehide", undefined, snap());
    // Page Lifecycle. `freeze` is Chrome telling us outright that it has
    // stopped running this page's tasks — the single most direct evidence
    // there is for "the recovery code could not run". `resume` is the thaw.
    const onFreeze = () => diag("page-FROZEN", "Chrome froze the page", snap());
    const onResume = () => diag("page-thawed", "Chrome resumed the page", snap());

    document.addEventListener("visibilitychange", onVisibility);
    // iOS restoring a page from the back/forward cache fires pageshow, not
    // visibilitychange — without this, the PWA's most common return path would
    // be the one left unhandled.
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("freeze", onFreeze);
    document.addEventListener("resume", onResume);

    const watchdog = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const audio = audioRef.current;
      if (audio && isStalled(audio)) nudge();
    }, WATCHDOG_INTERVAL_MS);

    // ---- the heartbeat ------------------------------------------------------
    // Measures the one thing no other instrument can: whether this page is
    // still being given CPU. It records nothing but its own lateness and the
    // player's state, and it acts on neither — a diagnostic must not become a
    // second, secret recovery ladder, or the evidence would describe a player
    // that no longer exists.
    let lastBeat = Date.now();
    let lastLogged = 0;
    let lastShape = "";
    const heartbeat = window.setInterval(() => {
      const now = Date.now();
      const late = now - lastBeat;
      lastBeat = now;
      const s = snap();
      // A shape change worth a line: playing/paused, visible/hidden, online,
      // and the buffer bucketed to whole seconds under 10s (where starvation
      // actually happens) so ordinary drift doesn't fill the ring.
      const shape = [
        s.pd ? "p" : "-",
        s.vs,
        s.on ? "on" : "OFF",
        s.rs,
        s.fb !== undefined ? Math.min(10, Math.floor(s.fb)) : "?",
      ].join("");
      const overdue = late > HEARTBEAT_MS * HEARTBEAT_LATE_RATIO;
      if (overdue || shape !== lastShape || now - lastLogged > HEARTBEAT_PULSE_MS) {
        lastShape = shape;
        lastLogged = now;
        diag(
          overdue ? "beat-LATE" : "beat",
          overdue ? `asked for ${HEARTBEAT_MS}ms, arrived after ${late}ms` : undefined,
          s,
        );
      }
    }, HEARTBEAT_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
      window.clearInterval(watchdog);
      window.clearInterval(heartbeat);
    };
  }, [recoverStream, spendRecovery, retry, snap, attemptPlay]);

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

  // ---- the queue survives a reload ----------------------------------------
  // Restore the last run once, on mount, PAUSED and seeked to where it stopped.
  // Nothing plays until the listener asks — an autoplaying page is both rude and
  // blocked by every browser — but the bar is there, holding their place.
  //
  // This has to be an effect, and it has to set state in the body. Reading
  // localStorage in a useState initializer would be the tidier shape, but it
  // runs during SSR too: the server would render no now-playing bar and the
  // client would render one, which is a hydration mismatch. Restoring after
  // mount costs exactly one extra render, once, and is the reason the rule
  // below is waived here rather than worked around.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    // Mark the boundary. Every reload writes one of these, so a timeline that
    // shows a session-start the listener didn't ask for is a page the browser
    // discarded and rebuilt — a different failure entirely from a stall.
    diag(
      "session-start",
      `${
        window.matchMedia?.("(display-mode: standalone)").matches
          ? "standalone PWA"
          : "browser tab"
      } · watchdog=${WATCHDOG_INTERVAL_MS}ms(visible-only) · stall=${STALL_MS}ms · heartbeat=${HEARTBEAT_MS}ms`,
      snap(),
    );
    const saved = readPersistedState();
    if (!saved) return;
    restoreTimeRef.current = saved.time > 0 ? saved.time : null;
    /* eslint-disable react-hooks/set-state-in-effect */
    setRepeatMode(saved.repeatMode);
    setQueue(saved.queue);
    setIndex(saved.index);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [snap]);

  // Write the snapshot whenever the run changes, and again on the way out.
  // `currentTime` deliberately is NOT a dependency — it ticks several times a
  // second, and persisting that often would be absurd. The position is read
  // fresh off the element at each write instead.
  useEffect(() => {
    if (queue.length === 0 || index < 0) return;

    const save = () => {
      const audio = audioRef.current;
      // A position still waiting to be applied IS the truth: this effect runs
      // the moment a restored queue lands, before the source has attached, when
      // the element still reads 0 — writing that back would erase the very
      // position we just restored.
      const pending = restoreTimeRef.current;
      const time =
        pending !== null
          ? pending
          : audio && Number.isFinite(audio.currentTime)
            ? audio.currentTime
            : 0;
      try {
        // Persist a WINDOW around the current track, not the first N. Slicing
        // from the top and clamping the index would silently hand back a
        // different song than the one that was playing.
        const start = Math.min(
          index,
          Math.max(0, queue.length - MAX_PERSISTED_TRACKS),
        );
        const snapshot: PersistedState = {
          v: PLAYER_STATE_VERSION,
          savedAt: Date.now(),
          queue: queue.slice(start, start + MAX_PERSISTED_TRACKS),
          index: index - start,
          time,
          repeatMode,
        };
        window.localStorage.setItem(
          PLAYER_STATE_KEY,
          JSON.stringify(snapshot),
        );
      } catch {
        // Storage full or denied (private mode) — losing the resume point is
        // not worth breaking playback over.
      }
    };

    save();
    // Checkpoint on a slow interval so an unexpected close still lands close to
    // where the listener was, and on pagehide — the one teardown event mobile
    // Safari reliably fires (it often skips beforeunload / unload entirely).
    const ticker = window.setInterval(save, 5_000);
    window.addEventListener("pagehide", save);
    return () => {
      window.clearInterval(ticker);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, [queue, index, repeatMode]);

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
