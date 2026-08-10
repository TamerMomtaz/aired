"use client";

import { useSyncExternalStore } from "react";

// ---------------------------------------------------------------------------
// The flight recorder.
//
// A car stops playing music on a dark screen and nobody is there to watch a
// console. So the player writes its own black box: a rolling, timestamped,
// localStorage-backed ring of every transport event, every error, every
// recovery attempt and its outcome — durable enough to survive the failure,
// the freeze, the reload, and the drive home.
//
// Three rules shape this file, and all three come from the failure it exists to
// catch:
//
//   1. WRITE-THROUGH, SYNCHRONOUSLY. Chrome can freeze a backgrounded page
//      between one task and the next; anything queued for "later" is lost. Each
//      append serialises straight to localStorage. Event volume is a handful
//      per minute, so the cost is noise — and the guarantee is worth far more
//      than the microseconds.
//
//   2. NEVER GATE ON VISIBILITY. The whole point is to observe a page that is
//      hidden. Nothing here checks document.hidden before recording.
//
//   3. MEASURE THE SILENCE. The interesting quantity is not what happened but
//      WHEN — specifically, the gap between events. A heartbeat that should tick
//      every 5s and instead ticks after 61s is the signature of Chrome's
//      intensive throttling, and that gap is the evidence. So every entry keeps
//      both a wall clock and a monotonic clock: wall-clock gaps show elapsed
//      time, and a wall/monotonic divergence shows the device actually slept.
// ---------------------------------------------------------------------------

const LOG_KEY = "aired_diag_v1";
const ENABLED_KEY = "aired_diag_on";
// A ring this size holds roughly an hour of ordinary driving, and far more of a
// quiet one — heartbeats only land when something changed or a gap was
// anomalous. Serialised it sits around 40–60 KB.
const MAX_ENTRIES = 400;

// A compact snapshot of everything worth knowing at the instant of an event.
// Short keys: this is written to localStorage on every append and read back as
// text, so the bytes are worth saving. The exporter spells them out again.
export type DiagSnapshot = {
  /** audio.currentTime */
  ct?: number;
  /** seconds of buffered audio AHEAD of the playhead — the tunnel budget */
  fb?: number;
  /** audio.readyState (0 NOTHING … 4 ENOUGH_DATA) */
  rs?: number;
  /** audio.networkState (0 EMPTY, 1 IDLE, 2 LOADING, 3 NO_SOURCE) */
  ns?: number;
  /** audio.paused */
  pd?: boolean;
  /** audio.playbackRate — a rate of 0 is a browser-suspended element */
  pr?: number;
  /** document.visibilityState, "v" | "h" */
  vs?: "v" | "h";
  /** navigator.onLine */
  on?: boolean;
  /** connection.effectiveType — "4g", "3g", … (cell handoff evidence) */
  nt?: string;
  /** connection.downlink, Mbps */
  dl?: number;
  /** the LISTENER's intent (wantsPlayRef) — is sound supposed to be on? */
  wp?: boolean;
  /** navigator.mediaSession.playbackState */
  ms?: string;
  /** recovery budget spent so far */
  rc?: number;
  /** audio.error.code, if the element is in an error state */
  ec?: number;
  /** is an hls.js instance currently attached? */
  hls?: boolean;
};

export type DiagEntry = {
  /** wall clock, ms since epoch */
  t: number;
  /** performance.now(), ms — diverges from `t` when the device truly slept */
  m: number;
  /** event kind, e.g. "hls-error", "recover", "heartbeat" */
  k: string;
  /** free-text detail */
  d?: string;
  s?: DiagSnapshot;
};

let entries: DiagEntry[] = [];
let loaded = false;
let enabled = true;
const listeners = new Set<() => void>();

// useSyncExternalStore compares snapshots by identity, and `entries` is mutated
// in place — returning it directly would hand React the same reference every
// time and the screen would never update. So reads go through a cache that is
// dropped on every write: one fresh array per change, one stable array between
// changes, which is exactly the contract the hook wants.
let snapshotCache: DiagEntry[] | null = null;

function emit() {
  snapshotCache = null;
  for (const l of listeners) l();
}

function readEnabled(): boolean {
  try {
    // Default ON. This bug is intermittent, unattended, and happens on a dark
    // screen in a moving car — an opt-in flag is a flag you discover you forgot
    // exactly once, after the drive that would have caught it.
    return window.localStorage.getItem(ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  if (typeof window === "undefined") return;
  enabled = readEnabled();
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as DiagEntry[];
    if (Array.isArray(parsed)) entries = parsed.slice(-MAX_ENTRIES);
  } catch {
    // Unreadable or storage denied — start a fresh recorder rather than throw.
    entries = [];
  }
}

function persist() {
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // Storage full: drop the oldest half and try once more. Losing old history
    // is acceptable; losing the entries around the failure is not.
    try {
      entries = entries.slice(-Math.floor(MAX_ENTRIES / 2));
      window.localStorage.setItem(LOG_KEY, JSON.stringify(entries));
    } catch {
      // Private mode or a hard quota — keep recording in memory only.
    }
  }
}

/**
 * Record one event. Safe to call from anywhere, at any time, in any visibility
 * state — it never throws, and it writes through to storage before returning.
 */
export function diag(kind: string, detail?: string, snap?: DiagSnapshot): void {
  if (typeof window === "undefined") return;
  load();
  if (!enabled) return;
  const entry: DiagEntry = {
    t: Date.now(),
    m: Math.round(typeof performance !== "undefined" ? performance.now() : 0),
    k: kind,
  };
  if (detail) entry.d = detail;
  if (snap) entry.s = snap;
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  persist();
  emit();
}

export function getEntries(): DiagEntry[] {
  load();
  if (!snapshotCache) snapshotCache = entries.slice();
  return snapshotCache;
}

export function clearEntries(): void {
  load();
  entries = [];
  persist();
  emit();
}

export function isDiagEnabled(): boolean {
  load();
  return enabled;
}

export function setDiagEnabled(on: boolean): void {
  load();
  enabled = on;
  try {
    window.localStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  } catch {
    // Can't remember the choice across reloads — honour it for this session.
  }
  emit();
}

// ---- the React binding ----------------------------------------------------
// useSyncExternalStore, matching src/lib/offline/store.ts and the install flow:
// a stable snapshot, SSR-safe, and no state-in-effect cascade.

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const SSR_EMPTY: DiagEntry[] = [];

export function useDiagEntries(): DiagEntry[] {
  return useSyncExternalStore(
    subscribe,
    () => getEntries(),
    () => SSR_EMPTY,
  );
}

export function useDiagEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isDiagEnabled(),
    () => true,
  );
}

// ---- export ---------------------------------------------------------------

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function wallClock(t: number): string {
  const d = new Date(t);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(
    d.getMilliseconds(),
  ).padStart(3, "0")}`;
}

function gap(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `+${m}m${two(s)}s`;
}

function num(n: number | undefined, digits = 1): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "?";
}

function renderSnapshot(s: DiagSnapshot | undefined): string {
  if (!s) return "";
  const bits: string[] = [];
  if (s.ct !== undefined) bits.push(`at=${num(s.ct)}s`);
  if (s.fb !== undefined) bits.push(`buf=${num(s.fb)}s`);
  if (s.rs !== undefined) bits.push(`ready=${s.rs}`);
  if (s.ns !== undefined) bits.push(`net=${s.ns}`);
  if (s.pd !== undefined) bits.push(s.pd ? "PAUSED" : "playing");
  if (s.pr !== undefined && s.pr !== 1) bits.push(`rate=${s.pr}`);
  if (s.vs !== undefined) bits.push(s.vs === "v" ? "visible" : "HIDDEN");
  if (s.on === false) bits.push("OFFLINE");
  if (s.nt) bits.push(s.nt);
  if (s.dl !== undefined) bits.push(`${num(s.dl)}Mbps`);
  if (s.wp !== undefined) bits.push(s.wp ? "wants=play" : "wants=stop");
  if (s.ms) bits.push(`ms=${s.ms}`);
  if (s.rc) bits.push(`recov=${s.rc}`);
  if (s.ec !== undefined) bits.push(`ERRCODE=${s.ec}`);
  if (s.hls === false) bits.push("no-hls");
  return bits.join(" ");
}

/**
 * The whole recorder as plain text, ready to copy out of the phone and paste
 * into a conversation. The GAP column is the point of the whole exercise: it is
 * where a throttled page announces itself.
 */
export function formatLog(rows: DiagEntry[] = getEntries()): string {
  const out: string[] = [];
  out.push("AIRED player diagnostics");
  if (rows.length === 0) {
    out.push("(empty — nothing recorded yet)");
    return out.join("\n");
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  out.push(`window : ${new Date(first.t).toISOString()} → ${new Date(last.t).toISOString()}`);
  out.push(`entries: ${rows.length} (cap ${MAX_ENTRIES})`);
  if (typeof navigator !== "undefined") {
    out.push(`ua     : ${navigator.userAgent}`);
  }
  if (typeof window !== "undefined") {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ?? false;
    out.push(`display: ${standalone ? "standalone (installed PWA)" : "browser tab"}`);
  }
  out.push("");
  // 19 wide fits the longest kind ("resume-probe-FROZEN") so the event column
  // stays a column — a timeline you have to read jagged is a timeline you skim.
  out.push("  #  clock         gap        event                detail");
  out.push("  -  ------------  ---------  -------------------  ------------------------");

  let prev: DiagEntry | null = null;
  rows.forEach((e, i) => {
    const wallGap = prev ? e.t - prev.t : 0;
    const monoGap = prev ? e.m - prev.m : 0;
    // A wall clock that ran ahead of the monotonic clock means the device
    // actually suspended rather than merely throttled the page.
    const slept = prev && wallGap - monoGap > 1500 ? ` SLEPT~${Math.round((wallGap - monoGap) / 1000)}s` : "";
    const detail = [e.d, renderSnapshot(e.s)].filter(Boolean).join("  ");
    out.push(
      `${String(i + 1).padStart(3)}  ${wallClock(e.t)}  ${(prev ? gap(wallGap) : "—").padEnd(9)}  ${e.k.padEnd(19)}  ${detail}${slept}`,
    );
    prev = e;
  });
  return out.join("\n");
}
