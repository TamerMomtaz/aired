// STEMS — each live song split once into four parts (vocals, drums, bass, the
// rest) so the in-app Mixer can mix like a club DJ: swap basslines instead of
// stacking two, bring one song's drums in under another's vocal, lay one
// song's voice over another's beat.
//
// The split runs here, on the worker, with the open Demucs model (htdemucs,
// MIT licence, baked into the image). Each stem becomes its own HLS rendition
// with the same encoder and segment length as the song, so a second in a stem
// is the same second in the song the Mixer analysed.
//
// The originals are never touched: stems are extra files under
//   aired-hls/work/<id>/stems/<token>/<stem>/playlist.m3u8
// and a done.json beside them. <token> is an HMAC of the work id with the
// worker's shared secret, so a clean vocal can't be found by guessing a URL;
// the app computes the same token server-side and hands it only to the Mixer.
//
// Nobody has to trigger it: a slow background sweep splits every live song
// that has no stems yet (one at a time, at low CPU priority, so uploads still
// go live in minutes), and a freshly transcoded song is queued straight away.

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { config } from "./config.js";
import { transcodeToHls } from "./ffmpeg.js";
import { log, logErr } from "./logger.js";
import { downloadFromR2, objectExists, uploadToR2 } from "./r2.js";
import { supabase } from "./supabase.js";

export const STEMS = ["vocals", "drums", "bass", "other"];

export function stemToken(workId) {
  return createHmac("sha256", config.sharedSecret ?? "")
    .update(`aired-stems:${workId}`)
    .digest("hex")
    .slice(0, 32);
}

export function stemsPrefix(workId) {
  return `work/${workId}/stems/${stemToken(workId)}`;
}

const doneKey = (workId) => `${stemsPrefix(workId)}/done.json`;

export async function hasStems(workId) {
  return objectExists({ bucket: config.r2HlsBucket, key: doneKey(workId) });
}

// Demucs, as a child process at low priority. Writes <out>/<stem>.wav.
function runDemucs(inputPath, outDir) {
  return new Promise((resolve, reject) => {
    const args = [
      "-n",
      String(config.stemsNice),
      config.stemsPython,
      "-m",
      "demucs.separate",
      "-n",
      config.stemsModel,
      "-d",
      "cpu",
      "-j",
      "1",
      "--segment",
      "7",
      "-o",
      outDir,
      "--filename",
      "{stem}.{ext}",
      inputPath,
    ];
    const proc = spawn("nice", args, {
      env: { ...process.env, OMP_NUM_THREADS: String(config.stemsThreads) },
    });
    let stderr = "";
    const keep = (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    };
    proc.stderr.on("data", keep);
    proc.stdout.on("data", keep);
    proc.on("error", (err) => reject(new Error(`Failed to start demucs: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`demucs exited with code ${code}. Last output:\n${stderr.slice(-2000)}`));
    });
  });
}

async function findStemFiles(root) {
  // demucs writes <out>/<model>/<stem>.wav with --filename "{stem}.{ext}".
  const found = {};
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        const stem = e.name.replace(/\.wav$/, "");
        if (STEMS.includes(stem)) found[stem] = p;
      }
    }
  };
  await walk(root);
  return found;
}

export async function splitWork(workId) {
  const startedAt = Date.now();
  const { data: work, error } = await supabase
    .from("work")
    .select("id, status, taken_down, audio_master_key")
    .eq("id", workId)
    .single();
  if (error) throw new Error(`Could not read work ${workId}: ${error.message}`);
  if (work.status !== "live" || work.taken_down || !work.audio_master_key) {
    log(`stems work=${workId} skipped (status=${work.status} taken_down=${work.taken_down})`);
    return { workId, skipped: true };
  }

  const tmp = await mkdtemp(join(tmpdir(), `aired-stems-${workId}-`));
  try {
    const ext = (extname(work.audio_master_key) || ".bin").toLowerCase();
    const master = join(tmp, `master${ext}`);
    await downloadFromR2({ bucket: config.r2MastersBucket, key: work.audio_master_key, destPath: master });

    // Demucs reads WAV most reliably; decode once with ffmpeg.
    const wav = join(tmp, "song.wav");
    await new Promise((resolve, reject) => {
      const p = spawn("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-i", master, "-vn", "-ac", "2", "-ar", "44100", wav]);
      p.on("error", reject);
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg decode exited ${c}`))));
    });

    const sepDir = join(tmp, "sep");
    await runDemucs(wav, sepDir);
    const files = await findStemFiles(sepDir);
    const missing = STEMS.filter((s) => !files[s]);
    if (missing.length) throw new Error(`demucs gave no ${missing.join(", ")}`);

    const prefix = stemsPrefix(workId);
    const segments = {};
    for (const stem of STEMS) {
      const outDir = join(tmp, `hls-${stem}`);
      await mkdir(outDir);
      await transcodeToHls({
        inputPath: files[stem],
        outputDir: outDir,
        audioBitrate: config.stemsBitrate,
        segmentSeconds: config.hlsSegmentSeconds,
      });
      const produced = await readdir(outDir);
      const segs = produced.filter((f) => f.endsWith(".ts")).sort();
      for (const seg of segs) {
        await uploadToR2({
          bucket: config.r2HlsBucket,
          key: `${prefix}/${stem}/${seg}`,
          body: await readFile(join(outDir, seg)),
          contentType: "video/mp2t",
        });
      }
      await uploadToR2({
        bucket: config.r2HlsBucket,
        key: `${prefix}/${stem}/playlist.m3u8`,
        body: await readFile(join(outDir, "playlist.m3u8")),
        contentType: "application/vnd.apple.mpegurl",
      });
      segments[stem] = segs.length;
    }

    // Written last: the Mixer only uses stems once all four are in place.
    await uploadToR2({
      bucket: config.r2HlsBucket,
      key: doneKey(workId),
      body: JSON.stringify({ model: config.stemsModel, stems: STEMS, segments, at: new Date().toISOString() }),
      contentType: "application/json",
    });
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log(`stems work=${workId} DONE ${STEMS.join("/")} elapsed=${elapsed}s`);
    return { workId, segments };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- the queue and the background sweep ----

const queue = [];
const queued = new Set();
let running = false;

export function queueStems(workId) {
  if (!config.stemsEnabled || queued.has(workId)) return;
  queued.add(workId);
  queue.push(workId);
  void drain();
}

async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      try {
        if (!(await hasStems(id))) await splitWork(id);
      } catch (err) {
        logErr(`stems work=${id} failed`, err);
      } finally {
        queued.delete(id);
      }
    }
  } finally {
    running = false;
  }
}

async function sweep() {
  try {
    const { data, error } = await supabase
      .from("work")
      .select("id")
      .eq("status", "live")
      .eq("taken_down", false)
      .not("audio_master_key", "is", null)
      .order("id", { ascending: true })
      .limit(5000);
    if (error) throw new Error(error.message);
    let added = 0;
    for (const { id } of data ?? []) {
      if (queued.has(id)) continue;
      if (await hasStems(id)) continue;
      queueStems(id);
      added++;
    }
    if (added) log(`stems sweep queued ${added} song(s)`);
  } catch (err) {
    logErr("stems sweep failed", err);
  }
}

export function startStemsSweep() {
  if (!config.stemsEnabled) {
    log("stems disabled (STEMS_ENABLED=0)");
    return;
  }
  setTimeout(() => void sweep(), 60_000);
  setInterval(() => void sweep(), config.stemsSweepMinutes * 60_000);
  log(`stems sweep on (model ${config.stemsModel}, every ${config.stemsSweepMinutes} min)`);
}
