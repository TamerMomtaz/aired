"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { formatDuration } from "@/lib/format";
import { formatLrcTimestamp, parseLrc, toLrc } from "@/lib/lyrics/lrc";
import { saveLyrics } from "@/lib/works/actions";

// Owner-only lyrics editor with tap-sync (Phase 4). Two steps behind one entry:
//  • text — a plain textarea, one lyric line per line (save as static lyrics).
//  • sync — its OWN <audio> on the same HLS stream (so the public player is never
//    disturbed); play it and tap the spacebar / button to stamp each line's time.
// On save it serializes lines+times to LRC and calls saveLyrics. Re-opening loads
// the existing LRC so timing can be redone from any line.

const R2_BASE = (process.env.NEXT_PUBLIC_R2_PUBLIC_BASE ?? "").replace(
  /\/+$/,
  "",
);

function buildStreamUrl(key: string | null | undefined): string | null {
  if (!key || !key.trim() || !R2_BASE) return null;
  return `${R2_BASE}/${key.trim().replace(/^\/+/, "")}`;
}

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-base text-foreground outline-none transition placeholder:text-muted/60 focus:border-cert-red/60 focus:bg-white/[0.07] focus:ring-1 focus:ring-cert-red/40";
const primaryBtn =
  "rounded-lg bg-cert-red px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const ghostBtn =
  "rounded-lg border border-white/12 px-4 py-2.5 text-sm text-muted transition hover:text-foreground disabled:opacity-60";

type Step = "closed" | "text" | "sync";

export function LyricsSyncEditor({
  workId,
  hlsPlaylistKey,
  initialLyrics,
  onEnterSync,
}: {
  workId: number;
  hlsPlaylistKey: string | null | undefined;
  initialLyrics: string | null;
  // Pause the public player when the editor's own audio takes over.
  onEnterSync?: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("closed");

  const [text, setText] = useState("");
  const [times, setTimes] = useState<(number | null)[]>([]);
  const [armed, setArmed] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The editor's own audio element — independent of the public RedLinePlayer.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);

  // The bounded scroll container for the lyric line list, and per-line refs
  // for the "armed line scrolled to center" behavior.
  const listRef = useRef<HTMLOListElement | null>(null);
  const lineItemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const streamUrl = buildStreamUrl(hlsPlaylistKey);
  const hasLyrics = !!(initialLyrics && initialLyrics.trim());
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const allSynced = armed >= lines.length;

  // Mirror the values tap() needs into refs so the spacebar handler can be a
  // stable listener that never re-binds on every keystroke.
  const armedRef = useRef(armed);
  const lineCountRef = useRef(lines.length);
  useEffect(() => {
    armedRef.current = armed;
    lineCountRef.current = lines.length;
  }, [armed, lines.length]);

  function open() {
    const parsed = parseLrc(initialLyrics);
    setText(parsed.map((l) => l.text).join("\n"));
    setTimes(parsed.map((l) => l.t));
    setArmed(0);
    setError(null);
    setStep("text");
  }

  function close() {
    setStep("closed");
    setError(null);
  }

  function enterSync() {
    // Align the times array to the current line count (text may have changed).
    setTimes((prev) => lines.map((_, i) => (i < prev.length ? prev[i] : null)));
    setArmed(0);
    setError(null);
    setStep("sync");
    onEnterSync?.();
  }

  // Attach the editor's audio to the HLS stream while in sync mode; tear it all
  // down on leaving (destroyed on unmount) so it never lingers.
  useEffect(() => {
    if (step !== "sync") return;
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    let cancelled = false;

    (async () => {
      const { default: Hls } = await import("hls.js");
      if (cancelled) return;
      if (Hls.isSupported()) {
        const hls = new Hls();
        hlsRef.current = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(audio);
      } else if (audio.canPlayType("application/vnd.apple.mpegurl")) {
        audio.src = streamUrl;
      }
    })();

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      audio.removeAttribute("src");
      audio.load();
    };
  }, [step, streamUrl]);

  // Mirror the editor audio's state into React for its transport controls.
  useEffect(() => {
    if (step !== "sync") return;
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onDur = () =>
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDur);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDur);
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
    };
  }, [step]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function restart() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrent(0);
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrent(seconds);
  }

  // Stamp the armed line with the audio's current time and advance. Stable: it
  // reads the moving parts from refs, so the spacebar listener never re-binds.
  const tap = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const at = audio.currentTime;
    const a = armedRef.current;
    const n = lineCountRef.current;
    if (a >= n) return;
    setTimes((prev) => {
      const next = prev.slice();
      while (next.length < n) next.push(null);
      next[a] = at;
      return next;
    });
    setArmed(Math.min(a + 1, n));
  }, []);

  function backOne() {
    const prevIdx = Math.max(0, armedRef.current - 1);
    setTimes((t) => {
      const next = t.slice();
      if (prevIdx < next.length) next[prevIdx] = null;
      return next;
    });
    setArmed(prevIdx);
  }

  function nudge(i: number, delta: number) {
    setTimes((t) => {
      const next = t.slice();
      if (next[i] != null) next[i] = Math.max(0, (next[i] as number) + delta);
      return next;
    });
  }

  // Spacebar = tap, but only in sync mode and never while typing in a textarea.
  useEffect(() => {
    if (step !== "sync") return;
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "TEXTAREA") return;
      e.preventDefault();
      tap();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, tap]);

  // Keep the armed line centered in its bounded scroll box. All motion is
  // scoped to the list — the page never jumps, so the pinned transport (and
  // the line about to be stamped) stay on screen together.
  useEffect(() => {
    if (step !== "sync") return;
    const container = listRef.current;
    if (!container) return;
    const idx = Math.min(armed, lines.length - 1);
    if (idx < 0) return;
    const el = lineItemRefs.current[idx];
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const elOffset = eRect.top - cRect.top + container.scrollTop;
    const top = elOffset - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({
      top: Math.max(0, top),
      behavior: reduce ? "auto" : "smooth",
    });
  }, [step, armed, lines.length]);

  function save() {
    setError(null);
    const lrc = toLrc(lines.map((line, i) => ({ text: line, t: times[i] ?? null })));
    startTransition(async () => {
      const result = await saveLyrics(workId, lrc);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep("closed");
      router.refresh();
    });
  }

  if (step === "closed") {
    return (
      <button
        type="button"
        onClick={open}
        className="self-start text-xs text-cert-red underline-offset-4 hover:underline"
      >
        {hasLyrics ? "Edit lyrics / Sync" : "Add lyrics"}
      </button>
    );
  }

  if (step === "text") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">Lyrics</h3>
          <button
            type="button"
            onClick={close}
            className="text-xs text-muted transition hover:text-foreground"
          >
            Close
          </button>
        </div>
        <p className="text-xs text-muted">
          One lyric line per line. Save as-is for static lyrics, or sync them to
          the music so each line lights up on the Red Line.
        </p>
        <textarea
          className={`${fieldClass} min-h-48 resize-y font-mono`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Type or paste the lyrics…\none line at a time"}
          disabled={pending}
        />
        {error ? (
          <p role="alert" className="text-sm text-cert-red">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={enterSync}
            disabled={pending || !streamUrl || !text.trim()}
            className={primaryBtn}
          >
            Sync to music →
          </button>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className={ghostBtn}
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
        {!streamUrl ? (
          <p className="text-[11px] text-muted/70">
            Syncing unlocks once this track is streaming. You can save static
            lyrics now and add timing later.
          </p>
        ) : null}
      </div>
    );
  }

  // step === "sync"
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-5">
      <audio ref={audioRef} preload="metadata" />

      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Sync lyrics</h3>
        <div className="flex gap-3 text-xs">
          <button
            type="button"
            onClick={() => setStep("text")}
            className="text-muted transition hover:text-foreground"
          >
            ← Edit text
          </button>
          <button
            type="button"
            onClick={close}
            className="text-muted transition hover:text-foreground"
          >
            Close
          </button>
        </div>
      </div>

      {/* Transport + Tap, pinned so the controls never leave the viewport on
          long lyrics — sits just under the site header (h-14, z-20). */}
      <div className="sticky top-14 z-10 flex flex-col gap-3 rounded-xl border border-white/10 bg-background/90 p-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-cert-red text-white transition hover:brightness-110"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "❚❚" : "►"}
          </button>
          <button
            type="button"
            onClick={restart}
            className="rounded-lg border border-white/12 px-3 py-2 text-xs text-muted transition hover:text-foreground"
          >
            Restart
          </button>
          <span className="ml-auto font-mono text-[11px] text-muted">
            {formatDuration(current)} / {duration > 0 ? formatDuration(duration) : "—"}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          className="w-full accent-cert-red"
          aria-label="Seek"
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={tap}
            onKeyDown={(e) => {
              // The window listener owns the spacebar; suppress native key
              // activation so a focused Tap button can't double-fire.
              if (e.code === "Space" || e.code === "Enter") e.preventDefault();
            }}
            disabled={allSynced}
            className="flex-1 rounded-xl bg-cert-red px-4 py-4 text-sm font-semibold text-white shadow-[0_0_18px_-6px_var(--cert-red)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Stamp the current line and advance"
          >
            Tap <span className="opacity-70">(or press Space)</span>
          </button>
          <button
            type="button"
            onClick={backOne}
            disabled={armed === 0}
            className="rounded-xl border border-white/12 px-4 py-4 text-sm text-muted transition hover:text-foreground disabled:opacity-40"
          >
            Back one line
          </button>
        </div>

        <p className="text-xs text-muted">
          {allSynced
            ? "All lines stamped. Adjust any line below, or save."
            : `Armed: line ${armed + 1} of ${lines.length}. Play the track and tap on the beat.`}
        </p>
      </div>

      {/* The lines, with their stamps. Click a line to re-arm from there. The
          list scrolls inside its own bounded box so the editor never grows
          taller than the viewport on long lyrics; the armed line is held at
          the box's center by the effect above. */}
      <ol
        ref={listRef}
        className="relative flex max-h-96 flex-col gap-1 overflow-y-auto overscroll-contain pr-1"
      >
        {lines.map((line, i) => {
          const t = times[i] ?? null;
          const isArmed = i === armed;
          return (
            <li
              key={i}
              ref={(el) => {
                lineItemRefs.current[i] = el;
              }}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                isArmed
                  ? "bg-cert-red/10 ring-1 ring-cert-red/40"
                  : "hover:bg-white/[0.03]"
              }`}
            >
              <button
                type="button"
                onClick={() => setArmed(i)}
                className="flex-1 text-left"
                aria-label={`Arm line ${i + 1}`}
              >
                <span className={line.trim() ? "text-foreground" : "text-muted/40"}>
                  {line.trim() ? line : "(blank line)"}
                </span>
              </button>
              {t != null ? (
                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => nudge(i, -0.1)}
                    className="rounded border border-white/10 px-1.5 text-xs text-muted transition hover:text-foreground"
                    aria-label={`Nudge line ${i + 1} earlier`}
                  >
                    −
                  </button>
                  <span className="w-16 text-center font-mono text-[11px] text-cert-red">
                    {formatLrcTimestamp(t)}
                  </span>
                  <button
                    type="button"
                    onClick={() => nudge(i, 0.1)}
                    className="rounded border border-white/10 px-1.5 text-xs text-muted transition hover:text-foreground"
                    aria-label={`Nudge line ${i + 1} later`}
                  >
                    +
                  </button>
                </span>
              ) : (
                <span className="w-[6.25rem] text-right font-mono text-[11px] text-muted/40">
                  —
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p role="alert" className="text-sm text-cert-red">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className={`${primaryBtn} w-full`}
      >
        {pending ? "Saving…" : "Save synced lyrics"}
      </button>
    </div>
  );
}
