// ffmpeg invocation: one audio-only AAC rendition, packaged as a VOD HLS
// playlist with ~6s MPEG-TS segments.
//
// ffmpeg runs with cwd = outputDir and BARE relative output names, so the
// generated playlist references segments as plain filenames ("segment_00000.ts")
// rather than absolute paths — which is what we want once they sit side-by-side
// in R2.

import { spawn } from "node:child_process";

export function transcodeToHls({
  inputPath,
  outputDir,
  playlistName = "playlist.m3u8",
  segmentPattern = "segment_%05d.ts",
  audioBitrate,
  segmentSeconds,
}) {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      // Audio only: drop any embedded cover-art "video" stream, keep first audio.
      "-vn",
      "-map",
      "0:a:0",
      "-c:a",
      "aac",
      "-b:a",
      audioBitrate,
      "-ac",
      "2",
      // HLS / VOD packaging.
      "-f",
      "hls",
      "-hls_time",
      String(segmentSeconds),
      "-hls_playlist_type",
      "vod",
      "-hls_flags",
      "independent_segments",
      "-hls_segment_type",
      "mpegts",
      "-hls_segment_filename",
      segmentPattern,
      "-start_number",
      "0",
      playlistName,
    ];

    const proc = spawn("ffmpeg", args, { cwd: outputDir });

    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      // ffmpeg is chatty; keep only the tail so a long encode can't grow this
      // unbounded.
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
    });

    proc.on("error", (err) =>
      reject(new Error(`Failed to start ffmpeg (is it installed?): ${err.message}`)),
    );

    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`ffmpeg exited with code ${code}. Last output:\n${stderr.slice(-2000)}`),
        );
    });
  });
}
