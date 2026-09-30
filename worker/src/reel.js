// REELS — the lyric-video generator (Tee's spec, 2026-09-30). One song becomes
// an MP4 with its lyrics BIG on screen, so the reel doubles as a lyric video:
//
//   mode       snippet — the owner's teaser window (≤50s, the same clamp as the
//                        waveform clip) for Reels / TikTok / IG
//              full    — the whole song, start to finish, hard cap 12:00
//   shape      vertical 9:16 · square 1:1 · landscape 16:9 (reel-layout.js)
//   highlight  karaoke (word by word) · line (clean line-by-line reveal)
//
// The app serves the words and the names (title, credits, synced lyrics) as a
// manifest — the SAME live-only builder as the share cards, so a reel can never
// name makers differently from the card. The worker reads the work row itself
// for everything authoritative (live guard, master, duration, teaser window).
//
// A request never renders inline. requestReel() answers at once with the
// variant's status — ready (cached in R2) · queued · rendering (with progress) ·
// failed — and enqueues the render if nothing is cached or running (jobs.js).
// The R2 key carries a hash of everything that shapes the picture (the words,
// names, window, cover, style, render version), so an edited lyric or a new
// cover is a new key: a stale reel is structurally never served.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { clampClipWindow } from "./clip.js";
import { config } from "./config.js";
import {
  measureLuma,
  prepareReelBackground,
  probeDuration,
  renderReel,
} from "./ffmpeg.js";
import { createJobQueue } from "./jobs.js";
import { log, logErr } from "./logger.js";
import {
  deleteByPrefixExcept,
  downloadFromR2,
  objectSize,
  uploadToR2,
} from "./r2.js";
import { buildReelAss, lockupBox } from "./reel-ass.js";
import { REEL_OVERSCAN, REEL_PAN_PERIOD, REEL_SHAPES } from "./reel-layout.js";
import { getWorkForClip } from "./supabase.js";

export const REEL_MODES = new Set(["snippet", "full"]);
export const REEL_HIGHLIGHTS = new Set(["karaoke", "line"]);
export { REEL_SHAPE_NAMES } from "./reel-layout.js";

// Bump when the LOOK changes, so every cached reel re-renders on next request.
const REEL_RENDER_VERSION = 1;
// FULL mode: the whole song, but never past 12:00 (a longer track is cut there,
// with the audio faded out).
export const FULL_MAX_SECONDS = 12 * 60;
// Mean corner luma above which the lockup's wordmark flips to ink. ~118 is where
// ink on the background starts to out-contrast off-white.
const LUMA_INK_THRESHOLD = 118;
const ART_MAX_BYTES = 25 * 1024 * 1024;
// Every face a reel is set in (CJK comes from the image). libass falls back
// SILENTLY when a face is missing — the lockup would quietly draw in the wrong
// weight — so a missing file fails the render instead.
const REEL_FONT_FILES = [
  "Geist-Regular.ttf",
  "Geist-Bold.ttf",
  "Geist-ExtraBold.ttf",
  "Tajawal-Regular.ttf",
  "Tajawal-Bold.ttf",
];

// A song that can't have a public reel (not live, taken down, not transcoded, or
// no public manifest). The HTTP layer maps it to 404, never 500.
export class ReelUnavailableError extends Error {}

const queue = createJobQueue({
  snippet: config.reelSnippetConcurrency,
  full: config.reelFullConcurrency,
});

// variant ("id:mode:shape:highlight") → { key, meta } of its latest job, so a
// poll during a render answers from memory instead of re-planning each tick.
const variants = new Map();

function reelPrefix(workId, mode, shapeName, highlight) {
  return `work/${workId}/share/reel-${mode}-${shapeName}-${highlight}-`;
}

function assertReelable(work, workId) {
  if (work.status !== "live" || work.taken_down) {
    throw new ReelUnavailableError(
      `work ${workId} is not live (status=${work.status} taken_down=${work.taken_down}) — no reel`,
    );
  }
  if (!work.audio_master_key) {
    throw new ReelUnavailableError(`work ${workId} has no audio master yet — no reel`);
  }
}

async function fetchManifest(workId) {
  const url = `${config.appOrigin}/share/song/${workId}/reel-manifest`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) {
    throw new ReelUnavailableError(`work ${workId} has no public reel manifest`);
  }
  if (!res.ok) throw new Error(`manifest fetch failed: HTTP ${res.status} (${url})`);
  return res.json();
}

// Everything a render needs, and the R2 key it will live at.
async function planReel({ workId, mode, shapeName, highlight }) {
  const work = await getWorkForClip(workId);
  assertReelable(work, workId);
  const manifest = await fetchManifest(workId);

  const lines = (Array.isArray(manifest.lines) ? manifest.lines : [])
    .filter((l) => typeof l?.t === "number" && Number.isFinite(l.t) && l.t >= 0)
    .map((l) => ({ t: Math.round(l.t * 100) / 100, text: String(l.text ?? "") }));
  const hasLyrics = lines.some((l) => l.text.trim() !== "");
  // With nothing to highlight, both styles are the same video — one key.
  const style = hasLyrics ? highlight : "line";

  const duration =
    Number.isFinite(work.duration_seconds) && work.duration_seconds > 0
      ? work.duration_seconds
      : null;
  let window;
  if (mode === "full") {
    window = { start: 0, seconds: Math.min(duration ?? FULL_MAX_SECONDS, FULL_MAX_SECONDS) };
  } else {
    const w = clampClipWindow(work.clip_start_seconds, work.clip_length_seconds, work.duration_seconds);
    window = { start: w.start, seconds: w.length };
  }

  const text = {
    catalogId: String(manifest.catalogId ?? `AIRED-${String(workId).padStart(4, "0")}`),
    title: String(manifest.title ?? ""),
    names: (Array.isArray(manifest.names) ? manifest.names : []).map(String).filter(Boolean),
    certified: manifest.certified === true,
    address: String(manifest.address ?? "ai-red.io"),
    lines,
  };
  const coverUrl = typeof manifest.coverUrl === "string" ? manifest.coverUrl : null;
  const spec = {
    v: REEL_RENDER_VERSION,
    mode,
    shape: shapeName,
    highlight: style,
    window,
    duration,
    coverUrl,
    ...text,
  };
  const hash = createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 16);
  const shape = REEL_SHAPES[shapeName];
  return {
    workId,
    mode,
    shapeName,
    shape,
    highlight: style,
    window,
    duration,
    manifest: text,
    coverUrl,
    masterKey: work.audio_master_key,
    hasLyrics,
    key: `${reelPrefix(workId, mode, shapeName, style)}${hash}.mp4`,
    filename: `${text.catalogId}-${mode}-${shape.fileTag}.mp4`,
  };
}

// The status of one reel variant, enqueueing its render when it is neither
// cached nor already in hand. Shape of the answer:
//   { state: "ready", key, bytes, ...meta }
//   { state: "queued" | "rendering" | "failed", key, progress, position, error, ...meta }
// where meta = { lyrics: "synced" | "none", seconds, truncated, filename }.
export async function requestReel({ workId, mode, shape, highlight, retry = false }) {
  const variant = `${workId}:${mode}:${shape}:${highlight}`;
  const known = variants.get(variant);
  if (known) {
    if (retry) queue.forgetFailed(known.key);
    const status = queue.status(known.key);
    if (status) return { ...status, key: known.key, ...known.meta };
  }

  const plan = await planReel({ workId, mode, shapeName: shape, highlight });
  const meta = {
    lyrics: plan.hasLyrics ? "synced" : "none",
    seconds: plan.window.seconds,
    // A FULL reel of a song longer than 12:00 stops at 12:00 — say so.
    truncated: mode === "full" && plan.duration != null && plan.duration > FULL_MAX_SECONDS,
    filename: plan.filename,
  };
  variants.set(variant, { key: plan.key, meta });
  if (retry) queue.forgetFailed(plan.key);

  const active = queue.status(plan.key);
  if (active) return { ...active, key: plan.key, ...meta };

  const bytes = await objectSize({ bucket: config.r2HlsBucket, key: plan.key });
  if (bytes != null) return { state: "ready", key: plan.key, bytes, ...meta };

  const status = queue.enqueue({
    key: plan.key,
    lane: mode,
    run: (report) => renderPlannedReel(plan, report),
  });
  log(
    `work=${workId} reel ${mode}/${shape}/${plan.highlight} queued → ${plan.key} ` +
      `(window ${plan.window.start}+${plan.window.seconds}s, lyrics=${meta.lyrics})`,
  );
  return { ...status, key: plan.key, ...meta };
}

// Pull the cover to disk for ffmpeg. Best-effort: any failure (no cover, not
// https, too big, unreachable) returns null and the reel uses the branded field.
async function fetchArtwork(url, dir) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > ART_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > ART_MAX_BYTES) return null;
    const path = join(dir, "art");
    await writeFile(path, buf);
    return path;
  } catch (err) {
    logErr(`reel artwork fetch failed (${url}) — using the branded field`, err);
    return null;
  }
}

async function renderPlannedReel(plan, report) {
  const startedAt = Date.now();
  const { workId, shape } = plan;
  // GUARD again: the song may have been pulled while this job waited in line.
  assertReelable(await getWorkForClip(workId), workId);
  for (const file of REEL_FONT_FILES) {
    await access(join(config.reelFontsDir, file)).catch(() => {
      throw new Error(`reel font missing: ${join(config.reelFontsDir, file)} — refusing to render`);
    });
  }

  const tmp = await mkdtemp(join(tmpdir(), `aired-reel-${workId}-${plan.mode}-`));
  try {
    const ext = (extname(plan.masterKey) || ".bin").toLowerCase();
    const audioPath = join(tmp, `master${ext}`);
    await downloadFromR2({ bucket: config.r2MastersBucket, key: plan.masterKey, destPath: audioPath });

    let { window } = plan;
    let songSeconds = plan.duration;
    if (songSeconds == null) {
      songSeconds = await probeDuration(audioPath);
      if (plan.mode === "full" && songSeconds) {
        window = { start: 0, seconds: Math.min(songSeconds, FULL_MAX_SECONDS) };
      }
    }

    const bgPath = join(tmp, "bg.png");
    const bgWidth = await prepareReelBackground({
      artPath: await fetchArtwork(plan.coverUrl, tmp),
      outPath: bgPath,
      width: shape.width,
      height: shape.height,
      overscan: REEL_OVERSCAN,
      scrim: shape.scrim,
    });

    // The lockup flips to ink over a bright corner. Measure the whole strip the
    // corner sweeps through during the drift.
    let ink = false;
    try {
      const box = lockupBox(shape);
      const luma = await measureLuma(bgPath, {
        x: box.x,
        y: box.y,
        w: box.w + (bgWidth - shape.width),
        h: box.h,
      });
      ink = luma > LUMA_INK_THRESHOLD;
    } catch (err) {
      logErr(`work=${workId} lockup luma probe failed — keeping off-white`, err);
    }

    await writeFile(
      join(tmp, "reel.ass"),
      buildReelAss({ shape, manifest: plan.manifest, window, highlight: plan.highlight, ink }),
    );

    const full = plan.mode === "full";
    const outPath = join(tmp, "reel.mp4");
    await renderReel({
      cwd: tmp,
      bgPath,
      bgWidth,
      assFile: "reel.ass",
      fontsDir: config.reelFontsDir,
      audioPath,
      startSeconds: window.start,
      durationSeconds: window.seconds,
      width: shape.width,
      height: shape.height,
      fps: full ? config.reelFullFps : config.reelSnippetFps,
      panPeriod: REEL_PAN_PERIOD,
      // A 12-minute file stays a sane download: CRF 23, capped at 3 Mb/s.
      crf: full ? 23 : 21,
      maxrate: full ? "3M" : null,
      fadeIn: window.start > 0,
      fadeOut: songSeconds == null || window.start + window.seconds < songSeconds - 0.5,
      outPath,
      onProgress: (seconds) => report(Math.min(0.99, seconds / window.seconds)),
    });
    const bytes = (await stat(outPath)).size;

    await uploadToR2({
      bucket: config.r2HlsBucket,
      key: plan.key,
      body: createReadStream(outPath),
      contentType: "video/mp4",
      contentDisposition: `attachment; filename="${plan.filename}"`,
    });
    report(1);

    // Sweep this variant's older renders (a changed lyric / cover / window left
    // them behind). Best-effort: the app only ever asks for the current key.
    try {
      const swept = await deleteByPrefixExcept({
        bucket: config.r2HlsBucket,
        prefix: reelPrefix(workId, plan.mode, plan.shapeName, plan.highlight),
        exceptKey: plan.key,
      });
      if (swept > 0) log(`work=${workId} swept ${swept} stale reel(s)`);
    } catch (err) {
      logErr(`work=${workId} stale reel sweep failed (ignored)`, err);
    }

    log(
      `work=${workId} DONE reel ${plan.mode}/${plan.shapeName}/${plan.highlight} → ${plan.key} ` +
        `(${window.seconds}s of song, ${(bytes / 1e6).toFixed(1)} MB, ` +
        `${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
    );
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
