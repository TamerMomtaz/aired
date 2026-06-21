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
import { log } from "./logger.js";
import { renderShareClip } from "./ffmpeg.js";
import { downloadFromR2, objectExists, uploadToR2 } from "./r2.js";
import { getWorkForClip } from "./supabase.js";

export const CLIP_ORIENTATIONS = new Set(["vertical", "square"]);

// R2 key for a cached clip (public CDN bucket). Keyed by song id + format, so it
// is generated once and reused (brief).
export function clipKey(workId, orientation) {
  return `work/${workId}/share/clip-${orientation}.mp4`;
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

// Clamp the requested window to a sane, short clip (brief: ≤30s). A song shorter
// than the window is handled by ffmpeg's -shortest, so no need to know duration.
function clampDuration(requested) {
  const d = Number.isFinite(requested) ? requested : config.clipDefaultSeconds;
  return Math.min(config.clipMaxSeconds, Math.max(3, Math.round(d)));
}

export async function renderShareVideo(
  workId,
  { orientation = "vertical", startSeconds, durationSeconds, force = false } = {},
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

  const key = clipKey(workId, orientation);

  // Cache hit → reuse (rendered once, reused on repeat downloads).
  if (!force && (await objectExists({ bucket: config.r2HlsBucket, key }))) {
    log(`work=${workId} clip ${orientation} cache hit → ${key}`);
    return { workId, orientation, key, cached: true };
  }

  const start = Math.max(0, Number.isFinite(startSeconds) ? startSeconds : 0);
  const dur = clampDuration(durationSeconds);

  log(
    `work=${workId} render clip ${orientation} window=${start}..${start + dur}s`,
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
