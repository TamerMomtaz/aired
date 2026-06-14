// The pipeline for one work_id:
//   1. read the work row (service-role)
//   2. stream the master down from the private Supabase `masters` bucket
//   3. ffmpeg → audio-only HLS (AAC 192k, VOD, ~6s segments)
//   4. upload the master copy → R2 aired-masters; playlist + segments → aired-hls
//   5. record audio_master_key + hls_playlist_key on the work (status untouched)

import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { config } from "./config.js";
import { log } from "./logger.js";
import { createMasterSignedUrl, getWork, updateWorkKeys } from "./supabase.js";
import { uploadToR2 } from "./r2.js";
import { transcodeToHls } from "./ffmpeg.js";

const CONTENT_TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/mp2t",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

function contentTypeFor(name) {
  return CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";
}

// Run `fn` over `items` with a bounded number in flight (segments upload faster
// without flooding R2 with hundreds of parallel PUTs on a long track).
async function mapWithConcurrency(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

export async function transcodeWork(workId) {
  const startedAt = Date.now();
  log(`work=${workId} transcode requested`);

  const work = await getWork(workId);
  if (!work.master_storage_path) {
    throw new Error(`work ${workId} has no master_storage_path — nothing to transcode`);
  }
  log(
    `work=${workId} title=${JSON.stringify(work.title)} status=${work.status} master=${work.master_storage_path}`,
  );

  const tmp = await mkdtemp(join(tmpdir(), `aired-transcode-${workId}-`));
  try {
    // 1 + 2. Download the master from Supabase Storage, streamed to disk.
    const ext = (extname(work.master_storage_path) || ".bin").toLowerCase();
    const masterLocal = join(tmp, `master${ext}`);
    const signedUrl = await createMasterSignedUrl(work.master_storage_path);
    const res = await fetch(signedUrl);
    if (!res.ok || !res.body) {
      throw new Error(`master download failed: HTTP ${res.status} ${res.statusText}`);
    }
    await pipeline(Readable.fromWeb(res.body), createWriteStream(masterLocal));
    const masterBytes = (await stat(masterLocal)).size;
    log(`work=${workId} downloaded master (${masterBytes} bytes)`);

    // 3. ffmpeg → HLS into an output directory.
    const outDir = join(tmp, "hls");
    await mkdir(outDir);
    log(
      `work=${workId} ffmpeg → HLS (AAC ${config.audioBitrate}, ~${config.hlsSegmentSeconds}s VOD segments)`,
    );
    await transcodeToHls({
      inputPath: masterLocal,
      outputDir: outDir,
      audioBitrate: config.audioBitrate,
      segmentSeconds: config.hlsSegmentSeconds,
    });

    const produced = await readdir(outDir);
    const segments = produced.filter((f) => f.endsWith(".ts")).sort();
    if (!produced.includes("playlist.m3u8") || segments.length === 0) {
      throw new Error(
        `ffmpeg produced no playlist/segments (dir had: ${produced.join(", ") || "nothing"})`,
      );
    }
    log(`work=${workId} ffmpeg produced ${segments.length} segments + playlist`);

    // 4a. Master copy → R2 aired-masters (streamed; handles large masters).
    const audioMasterKey = `work/${workId}/master${ext}`;
    await uploadToR2({
      bucket: config.r2MastersBucket,
      key: audioMasterKey,
      body: createReadStream(masterLocal),
      contentType: contentTypeFor(masterLocal),
    });
    log(`work=${workId} uploaded master → ${config.r2MastersBucket}/${audioMasterKey}`);

    // 4b. Playlist + segments → R2 aired-hls, same prefix so the playlist's
    // relative segment names resolve. Upload segments first, playlist last.
    const hlsPrefix = `work/${workId}/hls`;
    const hlsPlaylistKey = `${hlsPrefix}/playlist.m3u8`;
    await mapWithConcurrency(segments, 6, async (seg) => {
      await uploadToR2({
        bucket: config.r2HlsBucket,
        key: `${hlsPrefix}/${seg}`,
        body: await readFile(join(outDir, seg)),
        contentType: contentTypeFor(seg),
      });
    });
    await uploadToR2({
      bucket: config.r2HlsBucket,
      key: hlsPlaylistKey,
      body: await readFile(join(outDir, "playlist.m3u8")),
      contentType: contentTypeFor("playlist.m3u8"),
    });
    log(
      `work=${workId} uploaded ${segments.length} segments + playlist → ${config.r2HlsBucket}/${hlsPrefix}/`,
    );

    // 5. Record both keys. Status stays draft (Phase 4 takes a work live).
    await updateWorkKeys(workId, { audioMasterKey, hlsPlaylistKey });

    const elapsedMs = Date.now() - startedAt;
    log(
      `work=${workId} DONE audio_master_key=${audioMasterKey} hls_playlist_key=${hlsPlaylistKey} segments=${segments.length} elapsed=${(elapsedMs / 1000).toFixed(1)}s`,
    );

    return {
      workId,
      audioMasterKey,
      hlsPlaylistKey,
      segmentCount: segments.length,
      masterBytes,
      elapsedMs,
    };
  } finally {
    // Always clean the scratch dir, success or failure.
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
