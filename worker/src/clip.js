// SHARE VIDEO — render one song's downloadable Reels / TikTok / IG clip.
//
// Instagram & TikTok accept no links and only VIDEO carries audio, so to share a
// song *with sound* we render a real MP4: the app's burned-in still frame (cover
// + named credits + brand), looped, with an audio-reactive waveform painted into
// the reserved band and the song's audio muxed underneath. Heavy work belongs
// here on the worker (ffmpeg), never in a Vercel request; the result is cached in
// R2 and reused.
//
// The pipeline for one (work_id, orientation):
//   1. read the work (service-role) and GUARD it is live & not taken down — a
//      draft / pending / pulled song never gets a public clip
//   2. short-circuit if the clip is already cached in R2 (unless force)
//   3. fetch the still frame PNG from the app (same buildSongCard() the image
//      cards use → identical credits) + read the waveform band from its headers
//   4. pull the song's master from R2 (the clip's audio source — a plain local
//      file, the robust transcode path) and grab the window
//   5. ffmpeg → frame + waveform + audio → H.264/AAC MP4
//   6. cache it in R2 (public CDN bucket) at work/{id}/share/clip-{orientation}.mp4

import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { config } from "./config.js";
import { log, logErr } from "./logger.js";
import { renderShareClip } from "./ffmpeg.js";
import {
  deleteByPrefixExcept,
  downloadFromR2,
  objectExists,
  uploadToR2,
} from "./r2.js";
import { getWorkForClip } from "./supabase.js";

export const CLIP_ORIENTATIONS = new Set(["vertical", "square"]);

// Teaser-clip window contract (per-song, art-directed in /manage). These MUST
// stay in lockstep with the app — src/lib/share/video.ts (key + defaults) — so
// both sides compute the SAME cache key and the same fallback window:
//   • a song that never set a window renders start 0, length 40
//   • length is bounded to [20, 50]; start leaves ≥5s of song after it; the
//     window is end-trimmed so it can never run past the real duration.
const DEFAULT_CLIP_START = 0;
const DEFAULT_CLIP_LENGTH = 40;
const MIN_CLIP_LENGTH = 20;
const MAX_CLIP_LENGTH = 50;
const MIN_CLIP_TAIL = 5;

// R2 key for a cached clip (public CDN bucket), VERSIONED by the chosen window.
// Keying by start+length is the invalidation mechanism: change the teaser and the
// key changes, so the previous clip is structurally never served (no delete call
// to fail). MUST match the app (src/lib/share/video.ts shareClipKey). The window
// values here are the RAW stored columns coalesced to the defaults (NOT the
// clamped ones), so the app can reproduce the key without sharing the clamp.
export function clipKey(workId, orientation, startSeconds, lengthSeconds) {
  return `work/${workId}/share/clip-${orientation}-s${startSeconds}-l${lengthSeconds}.mp4`;
}

// The key-space prefix covering ALL of a song's clips of one orientation — the
// new versioned ones AND the pre-versioning clip-{orientation}.mp4 — used to
// sweep stale windows once the current one is cached. "vertical" / "square" are
// not prefixes of each other, so this stays orientation-scoped.
function clipOrientationPrefix(workId, orientation) {
  return `work/${workId}/share/clip-${orientation}`;
}

// Clamp the owner's requested window to a safe slice that never runs past the
// song (brief, Part A). The worker is authoritative — it re-clamps against the
// REAL duration_seconds on the row and never trusts a client value:
//   start  = clamp(clip_start_seconds, 0, max(0, duration - 5))
//   length = clamp(clip_length_seconds, 20, 50)
//   if (start + length > duration) length = duration - start   // end-trim wins
// duration unknown (a row mid-transcode) → skip the end-relative parts and let
// ffmpeg's -shortest backstop trim a window longer than the audio.
function clampClipWindow(rawStart, rawLength, durationSeconds) {
  let length = Math.round(rawLength ?? DEFAULT_CLIP_LENGTH);
  if (!Number.isFinite(length)) length = DEFAULT_CLIP_LENGTH;
  length = Math.min(MAX_CLIP_LENGTH, Math.max(MIN_CLIP_LENGTH, length));

  let start = Math.round(rawStart ?? DEFAULT_CLIP_START);
  if (!Number.isFinite(start)) start = DEFAULT_CLIP_START;
  start = Math.max(0, start);

  const dur =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.round(durationSeconds)
      : null;
  if (dur != null) {
    start = Math.min(start, Math.max(0, dur - MIN_CLIP_TAIL));
    if (start + length > dur) length = dur - start; // end-trim wins
  }

  return { start, length: Math.max(1, length) };
}

// AIRED-#### download filename (zero-pad to 4, grows past 9999 — CLAUDE.md §2).
function catalogId(workId) {
  return `AIRED-${String(workId).padStart(4, "0")}`;
}

// "x,y,w,h" → { x, y, w, h }; throws if the header is missing/malformed so a
// bad frame response fails loudly rather than painting the waveform nowhere.
function parseRect(value, keys) {
  const parts = String(value ?? "")
    .split(",")
    .map((n) => Number.parseInt(n.trim(), 10));
  if (parts.length !== keys.length || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`bad rect header "${value}"`);
  }
  return Object.fromEntries(keys.map((k, i) => [k, parts[i]]));
}

export async function renderShareVideo(
  workId,
  { orientation = "vertical", force = false } = {},
) {
  const startedAt = Date.now();
  if (!CLIP_ORIENTATIONS.has(orientation)) {
    throw new Error(`unknown orientation "${orientation}"`);
  }

  const work = await getWorkForClip(workId);
  // GUARD: only a live, non-taken-down song gets a public clip.
  if (work.status !== "live" || work.taken_down) {
    throw new Error(
      `work ${workId} is not live (status=${work.status} taken_down=${work.taken_down}) — no clip`,
    );
  }
  if (!work.audio_master_key) {
    throw new Error(`work ${workId} has no audio master — nothing to clip`);
  }

  // The teaser window is read from the WORK ROW (Part A) — never from the caller.
  // The key uses the raw stored columns (coalesced to the defaults) so the app
  // reproduces it; the actual render uses the clamped window below.
  const keyStart = work.clip_start_seconds ?? DEFAULT_CLIP_START;
  const keyLength = work.clip_length_seconds ?? DEFAULT_CLIP_LENGTH;
  const key = clipKey(workId, orientation, keyStart, keyLength);

  // Cache hit → reuse (rendered once, reused on repeat downloads of this window).
  if (!force && (await objectExists({ bucket: config.r2HlsBucket, key }))) {
    log(`work=${workId} clip ${orientation} cache hit → ${key}`);
    return { workId, orientation, key, cached: true };
  }

  // Clamp authoritatively against the real duration so the window never runs past
  // the end (brief, Part A — songs range 94s..652s here).
  const { start, length: dur } = clampClipWindow(
    work.clip_start_seconds,
    work.clip_length_seconds,
    work.duration_seconds,
  );

  log(
    `work=${workId} render clip ${orientation} window=${start}..${start + dur}s ` +
      `(requested s${keyStart} l${keyLength}, duration=${work.duration_seconds ?? "?"}s)`,
  );

  const tmp = await mkdtemp(join(tmpdir(), `aired-clip-${workId}-${orientation}-`));
  try {
    // 3. Still frame from the app — identical credits to the image cards.
    const frameUrl = `${config.appOrigin}/share/song/${workId}/clip-frame/${orientation}`;
    const frameRes = await fetch(frameUrl);
    if (!frameRes.ok || !frameRes.body) {
      throw new Error(
        `frame fetch failed: HTTP ${frameRes.status} ${frameRes.statusText} (${frameUrl})`,
      );
    }
    const band = parseRect(frameRes.headers.get("x-clip-band"), [
      "x",
      "y",
      "w",
      "h",
    ]);
    const size = parseRect(frameRes.headers.get("x-clip-size"), [
      "width",
      "height",
    ]);
    // Defensive: the waveform band must sit inside the frame the app sent.
    if (
      band.x < 0 ||
      band.y < 0 ||
      band.x + band.w > size.width ||
      band.y + band.h > size.height
    ) {
      throw new Error(
        `band ${JSON.stringify(band)} does not fit frame ${size.width}x${size.height}`,
      );
    }
    const framePath = join(tmp, "frame.png");
    await pipeline(Readable.fromWeb(frameRes.body), createWriteStream(framePath));

    // 4. Master → local file (the clip's audio source).
    const ext = (extname(work.audio_master_key) || ".bin").toLowerCase();
    const audioPath = join(tmp, `master${ext}`);
    const { bytes: masterBytes } = await downloadFromR2({
      bucket: config.r2MastersBucket,
      key: work.audio_master_key,
      destPath: audioPath,
    });
    log(`work=${workId} pulled master (${masterBytes} bytes) for clip`);

    // 5. Compose.
    const outPath = join(tmp, "clip.mp4");
    await renderShareClip({
      framePath,
      audioPath,
      band,
      startSeconds: start,
      durationSeconds: dur,
      outPath,
      fps: config.clipFps,
    });
    const bytes = (await stat(outPath)).size;

    // 6. Cache in R2 (public CDN bucket) with a friendly download filename.
    await uploadToR2({
      bucket: config.r2HlsBucket,
      key,
      body: createReadStream(outPath),
      contentType: "video/mp4",
      contentDisposition: `attachment; filename="${catalogId(workId)}-${orientation}.mp4"`,
    });

    // 7. Now the current window is safely cached, sweep this song's STALE clips of
    // the same orientation (older windows + any pre-versioning clip-*.mp4) so they
    // don't accumulate. Best-effort: the app only ever asks for the current key, so
    // a failure here just leaves a harmless orphan — never a stale clip served.
    try {
      const swept = await deleteByPrefixExcept({
        bucket: config.r2HlsBucket,
        prefix: clipOrientationPrefix(workId, orientation),
        exceptKey: key,
      });
      if (swept > 0) {
        log(`work=${workId} swept ${swept} stale ${orientation} clip(s)`);
      }
    } catch (err) {
      logErr(`work=${workId} stale ${orientation} clip sweep failed (ignored)`, err);
    }

    const elapsedMs = Date.now() - startedAt;
    log(
      `work=${workId} DONE clip ${orientation} → ${config.r2HlsBucket}/${key} (${bytes} bytes, ${(elapsedMs / 1000).toFixed(1)}s)`,
    );
    return {
      workId,
      orientation,
      key,
      bytes,
      durationSeconds: dur,
      elapsedMs,
      cached: false,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
