import { formatCatalogId } from "@/lib/catalog";
import { buildStreamUrl } from "@/lib/stream-url";

// SHARE VIDEO plumbing — the app side of the downloadable Reels / TikTok clip.
// The heavy render runs on the Railway worker (ffmpeg) and is cached in R2; the
// app only (1) dispatches a render and (2) locates / proxies the cached MP4 off
// the public CDN. Mirrors the transcode trigger's Bearer-secret contract.

export type ClipOrientation = "vertical" | "square";
export const CLIP_ORIENTATIONS: ClipOrientation[] = ["vertical", "square"];

export function isClipOrientation(v: string): v is ClipOrientation {
  return (CLIP_ORIENTATIONS as string[]).includes(v);
}

// R2 key for a cached clip — MUST match the worker (worker/src/clip.js clipKey).
export function shareClipKey(workId: number, orientation: ClipOrientation): string {
  return `work/${workId}/share/clip-${orientation}.mp4`;
}

// The clip's public CDN URL (served from R2, zero-egress — Rule 6), or null when
// NEXT_PUBLIC_R2_PUBLIC_BASE is unset.
export function shareClipUrl(
  workId: number,
  orientation: ClipOrientation,
): string | null {
  return buildStreamUrl(shareClipKey(workId, orientation));
}

// "AIRED-0001-vertical.mp4" — the friendly saved filename.
export function shareClipFilename(
  workId: number,
  orientation: ClipOrientation,
): string {
  return `${formatCatalogId(workId)}-${orientation}.mp4`;
}

// Is the clip already cached on the CDN? A 1-byte ranged GET probes existence
// without pulling the whole file (HEAD isn't guaranteed on the r2.dev domain).
export async function shareClipExists(
  workId: number,
  orientation: ClipOrientation,
): Promise<boolean> {
  const url = shareClipUrl(workId, orientation);
  if (!url) return false;
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
    });
    // Drain the tiny body so the socket can be reused.
    await res.arrayBuffer().catch(() => {});
    return res.ok; // 200 or 206
  } catch {
    return false;
  }
}

// Fire-and-forget dispatch to the worker to render + cache the clip. Mirrors
// triggerTranscode: POST the job, then abort the response wait after a short
// window (closing our side does NOT cancel the worker's render — it finishes and
// uploads to R2). The worker dedups by (work_id, orientation), so repeated polls
// that re-dispatch collapse to one job. Best-effort: a missing worker config
// just logs and returns (the caller surfaces "couldn't make the video").
const ABORT_TIMEOUT_MS = 4_000;

export async function dispatchShareVideo(
  workId: number,
  orientation: ClipOrientation,
): Promise<void> {
  const workerUrl = process.env.AIRED_WORKER_URL?.replace(/\/+$/, "");
  const secret = process.env.TRANSCODE_SHARED_SECRET;
  if (!workerUrl || !secret) {
    console.warn(
      `[share-video] work=${workId} ${orientation} skipped — AIRED_WORKER_URL or TRANSCODE_SHARED_SECRET not set.`,
    );
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABORT_TIMEOUT_MS);
  try {
    const res = await fetch(`${workerUrl}/share-video`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ work_id: workId, orientation }),
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 409) {
      const detail = await res.text().catch(() => "");
      console.error(
        `[share-video] work=${workId} ${orientation} → HTTP ${res.status} ${detail}`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // Expected: the worker is mid-render, we stopped waiting.
      return;
    }
    console.error(`[share-video] work=${workId} ${orientation} dispatch failed`, err);
  } finally {
    clearTimeout(timer);
  }
}
