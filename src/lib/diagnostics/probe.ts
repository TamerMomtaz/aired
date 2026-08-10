"use client";

import type { DiagSnapshot } from "./log";

// Reading the world at the instant of an event. Everything here is defensive:
// a probe that throws would take down the very playback it is watching, and a
// missing field is infinitely better than a broken player.

type Connection = {
  effectiveType?: string;
  downlink?: number;
};

function connection(): Connection | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (navigator as Navigator & { connection?: Connection }).connection;
}

/**
 * Seconds of audio buffered AHEAD of the playhead.
 *
 * This is the number that decides how long a tunnel the car can survive: when
 * it reaches zero with no new segment in hand, sound stops. Returns 0 when the
 * playhead sits outside every buffered range (already starved).
 */
export function forwardBuffer(audio: HTMLAudioElement): number | undefined {
  try {
    const t = audio.currentTime;
    const ranges = audio.buffered;
    for (let i = 0; i < ranges.length; i += 1) {
      // +0.1 tolerance: the playhead routinely sits a few ms before the range
      // start right after a seek or an append.
      if (ranges.start(i) <= t + 0.1 && ranges.end(i) > t) {
        return Math.max(0, ranges.end(i) - t);
      }
    }
    return 0;
  } catch {
    return undefined;
  }
}

export type ProbeExtras = {
  /** the LISTENER's intent — wantsPlayRef, not the element's paused flag */
  wantsPlay?: boolean;
  /** how much of the recovery budget has been spent */
  recoveries?: number;
  /** is an hls.js instance still attached, or was it destroyed? */
  hls?: boolean;
};

/**
 * A full snapshot of the player and its environment. Cheap enough to take on
 * every event.
 */
export function probe(
  audio: HTMLAudioElement | null,
  extras: ProbeExtras = {},
): DiagSnapshot {
  const s: DiagSnapshot = {};

  if (audio) {
    if (Number.isFinite(audio.currentTime)) s.ct = round(audio.currentTime);
    const fb = forwardBuffer(audio);
    if (fb !== undefined) s.fb = round(fb);
    s.rs = audio.readyState;
    s.ns = audio.networkState;
    s.pd = audio.paused;
    s.pr = audio.playbackRate;
    if (audio.error) s.ec = audio.error.code;
  }

  if (typeof document !== "undefined") {
    s.vs = document.visibilityState === "visible" ? "v" : "h";
  }

  if (typeof navigator !== "undefined") {
    s.on = navigator.onLine;
    const c = connection();
    if (c?.effectiveType) s.nt = c.effectiveType;
    if (typeof c?.downlink === "number") s.dl = c.downlink;
    if ("mediaSession" in navigator) {
      s.ms = navigator.mediaSession.playbackState;
    }
  }

  if (extras.wantsPlay !== undefined) s.wp = extras.wantsPlay;
  if (extras.recoveries !== undefined) s.rc = extras.recoveries;
  if (extras.hls !== undefined) s.hls = extras.hls;

  return s;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
