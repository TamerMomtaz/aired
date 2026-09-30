import { buildStreamUrl } from "@/lib/stream-url";

// REELS — the app side of the lyric-video generator. A reel is a song's MP4 with
// its lyrics BIG on screen (so it doubles as a lyric video), rendered on the
// Railway worker (worker/src/reel.js) and cached in R2:
//
//   mode       snippet — the owner's teaser window, ≤50s (Reels / TikTok / IG)
//              full    — the whole song, hard cap 12:00 (a YouTube-shaped video)
//   shape      vertical 9:16 · square 1:1 · landscape 16:9
//   highlight  karaoke (word by word) · line (clean line-by-line reveal)
//
// The app never renders and never computes the cache key: it asks the worker
// for the variant's status (ready · queued · rendering · failed), which also
// enqueues the render when nothing is cached or running. A full song takes
// minutes, so the share sheet POLLS this with progress — never a blocking wait.

export type ReelMode = "snippet" | "full";
export type ReelShape = "vertical" | "square" | "landscape";
export type ReelHighlight = "karaoke" | "line";

export const REEL_MODES: ReelMode[] = ["snippet", "full"];
export const REEL_SHAPES: ReelShape[] = ["vertical", "square", "landscape"];
export const REEL_HIGHLIGHTS: ReelHighlight[] = ["karaoke", "line"];

export function isReelMode(v: string | null): v is ReelMode {
  return (REEL_MODES as (string | null)[]).includes(v);
}
export function isReelShape(v: string | null): v is ReelShape {
  return (REEL_SHAPES as (string | null)[]).includes(v);
}
export function isReelHighlight(v: string | null): v is ReelHighlight {
  return (REEL_HIGHLIGHTS as (string | null)[]).includes(v);
}

// What the share sheet sees on each poll.
export type ReelStatus = {
  status: "ready" | "queued" | "rendering" | "failed" | "preparing";
  // 0–1 while rendering.
  progress: number;
  // 1-based place in line while queued.
  position: number;
  // "none" → the song has no synced lyrics; the reel carries the title card.
  lyrics: "synced" | "none" | null;
  // Length of the reel in seconds, and whether a full song was cut at 12:00.
  seconds: number | null;
  truncated: boolean;
  // Ready only: the MP4 on the CDN (R2, zero egress — Rule 6), its size, name.
  url: string | null;
  bytes: number | null;
  filename: string | null;
};

type WorkerReply = {
  ok: boolean;
  state?: "ready" | "queued" | "rendering" | "failed";
  key?: string;
  progress?: number;
  position?: number;
  bytes?: number;
  lyrics?: "synced" | "none";
  seconds?: number;
  truncated?: boolean;
  filename?: string;
  error?: string;
};

export type ReelRequestResult =
  | { ok: true; reel: ReelStatus }
  | { ok: false; reason: "not-found" | "unavailable" };

const PREPARING: ReelStatus = {
  status: "preparing",
  progress: 0,
  position: 0,
  lyrics: null,
  seconds: null,
  truncated: false,
  url: null,
  bytes: null,
  filename: null,
};

// The worker answers from memory or after one quick plan (a work-row read, the
// manifest, an R2 HEAD) — it never renders inside the request. If it is slow
// anyway (a cold boot), we say "preparing" and let the next poll ask again.
const WORKER_TIMEOUT_MS = 10_000;

export async function requestReel(
  workId: number,
  mode: ReelMode,
  shape: ReelShape,
  highlight: ReelHighlight,
  { retry = false }: { retry?: boolean } = {},
): Promise<ReelRequestResult> {
  const workerUrl = process.env.AIRED_WORKER_URL?.replace(/\/+$/, "");
  const secret = process.env.TRANSCODE_SHARED_SECRET;
  if (!workerUrl || !secret) {
    console.warn(
      `[reel] work=${workId} skipped — AIRED_WORKER_URL or TRANSCODE_SHARED_SECRET not set.`,
    );
    return { ok: false, reason: "unavailable" };
  }

  let reply: WorkerReply;
  try {
    const res = await fetch(`${workerUrl}/reel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ work_id: workId, mode, shape, highlight, retry }),
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 404) return { ok: false, reason: "not-found" };
    reply = (await res.json()) as WorkerReply;
    if (!res.ok || !reply.ok || !reply.state) {
      console.error(`[reel] work=${workId} ${mode}/${shape} → HTTP ${res.status} ${reply.error ?? ""}`);
      return { ok: false, reason: "unavailable" };
    }
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      return { ok: true, reel: PREPARING };
    }
    console.error(`[reel] work=${workId} ${mode}/${shape} request failed`, err);
    return { ok: false, reason: "unavailable" };
  }

  const ready = reply.state === "ready";
  return {
    ok: true,
    reel: {
      status: reply.state,
      progress: reply.progress ?? (ready ? 1 : 0),
      position: reply.position ?? 0,
      lyrics: reply.lyrics ?? null,
      seconds: reply.seconds ?? null,
      truncated: reply.truncated === true,
      url: ready ? buildStreamUrl(reply.key) : null,
      bytes: ready ? (reply.bytes ?? null) : null,
      filename: reply.filename ?? null,
    },
  };
}
