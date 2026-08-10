"use client";

import { useMemo, useState } from "react";

import {
  clearEntries,
  formatLog,
  setDiagEnabled,
  useDiagEnabled,
  useDiagEntries,
} from "@/lib/diagnostics/log";

// The black box, readable from the driver's seat once the car has stopped.
//
// Everything here is deliberately plain: this screen exists to be read on a
// phone in daylight, one-handed, by someone who has just watched their music
// die and wants to know why. Newest event first, because the last thing that
// happened is the thing you came to see. The gap column is rendered wider and
// louder than the event name — the gaps ARE the evidence.

const KIND_TONE: Array<[RegExp, string]> = [
  // Loud: the failure and everything that failed to answer it.
  [/FATAL|ERROR|REJECTED|EXHAUSTED|DESTROY|STALL|FROZEN|UNWANTED|LATE/, "text-cert-red"],
  // Notable: the ladder trying.
  [/recover|retry|budget|give-up|waiting|stalled|suspend/, "text-amber-400"],
];

function toneFor(kind: string): string {
  for (const [re, tone] of KIND_TONE) if (re.test(kind)) return tone;
  return "text-muted";
}

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function clock(t: number): string {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

function gapLabel(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  return `+${m}m${two(Math.round((ms % 60_000) / 1000))}s`;
}

function snapLine(s: Record<string, unknown> | undefined): string {
  if (!s) return "";
  const bits: string[] = [];
  if (typeof s.ct === "number") bits.push(`at ${s.ct}s`);
  if (typeof s.fb === "number") bits.push(`buf ${s.fb}s`);
  if (typeof s.rs === "number") bits.push(`ready ${s.rs}`);
  if (s.pd === true) bits.push("PAUSED");
  if (s.vs === "h") bits.push("hidden");
  if (s.on === false) bits.push("OFFLINE");
  if (typeof s.nt === "string") bits.push(s.nt);
  if (s.wp === true) bits.push("wants play");
  if (typeof s.rc === "number" && s.rc > 0) bits.push(`recov ${s.rc}`);
  return bits.join(" · ");
}

export function DiagnosticsScreen() {
  const entries = useDiagEntries();
  const enabled = useDiagEnabled();
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  // Newest first. The gap on each row is the distance from the event BEFORE it
  // in real time, so it keeps its meaning under the reversal.
  const rows = useMemo(
    () =>
      entries
        .map((e, i) => ({ e, gap: i > 0 ? e.t - entries[i - 1].t : 0, n: i + 1 }))
        .reverse(),
    [entries],
  );

  // The export is a few hundred rows of string building. It feeds both the Copy
  // button and the fallback textarea, so build it once per change of the log
  // rather than on every keystroke-triggered render of this screen.
  const exported = useMemo(() => formatLog(entries), [entries]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exported);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    window.setTimeout(() => setCopied("idle"), 2500);
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Player diagnostics</h1>
        <p className="text-sm text-muted">
          A rolling record of what the audio engine did, kept on this device and
          nowhere else. It survives the app closing, the screen sleeping, and a
          reload — so a song that dies on a drive can be read back afterwards.
        </p>
      </header>

      {/* The two things you actually came to do, thumb-sized and at the top. */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="min-h-11 flex-1 rounded-lg bg-cert-red px-4 py-3 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-40"
          disabled={rows.length === 0}
        >
          {copied === "ok"
            ? "Copied ✓"
            : copied === "fail"
              ? "Copy failed — select below"
              : `Copy log (${rows.length})`}
        </button>
        <button
          type="button"
          onClick={() => setDiagEnabled(!enabled)}
          className="min-h-11 rounded-lg border border-white/15 px-4 py-3 text-sm text-foreground transition hover:bg-white/5"
        >
          {enabled ? "Recording · on" : "Recording · off"}
        </button>
        <button
          type="button"
          onClick={() => clearEntries()}
          className="min-h-11 rounded-lg border border-white/15 px-4 py-3 text-sm text-muted transition hover:bg-white/5"
        >
          Clear
        </button>
      </div>

      {!enabled ? (
        <p className="mb-6 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-300">
          Recording is off — nothing new is being written. Turn it back on before
          a drive you want captured.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-white/10 px-4 py-8 text-center text-sm text-muted">
          Nothing recorded yet. Play something.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-white/8 border-y border-white/8">
          {rows.map(({ e, gap, n }) => (
            <li key={`${e.t}-${n}`} className="flex gap-3 py-2.5 text-xs">
              <div className="w-14 shrink-0 font-mono text-muted tabular-nums">
                {clock(e.t)}
              </div>
              <div
                className={`w-16 shrink-0 font-mono tabular-nums ${
                  gap > 30_000 ? "font-semibold text-cert-red" : "text-muted"
                }`}
              >
                {n === 1 ? "—" : gapLabel(gap)}
              </div>
              <div className="min-w-0 flex-1">
                <div className={`font-mono font-medium ${toneFor(e.k)}`}>{e.k}</div>
                {e.d ? (
                  <div className="mt-0.5 break-words text-muted">{e.d}</div>
                ) : null}
                {e.s ? (
                  <div className="mt-0.5 font-mono text-[11px] text-muted/70">
                    {snapLine(e.s as unknown as Record<string, unknown>)}
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* The fallback for when the clipboard API is blocked — a plain textarea
          holding the same export, ready to long-press → Select all → Copy. */}
      <details className="mt-8">
        <summary className="cursor-pointer text-sm text-muted">
          Raw text (if Copy didn&rsquo;t work)
        </summary>
        <textarea
          readOnly
          value={exported}
          onFocus={(ev) => ev.currentTarget.select()}
          className="mt-3 h-64 w-full rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-foreground"
        />
      </details>
    </main>
  );
}
