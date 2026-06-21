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

// Shared spawn → Promise for an ffmpeg run (resolves on exit 0, rejects with the
// stderr tail otherwise).
function runFfmpeg(args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, cwd ? { cwd } : undefined);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
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

// AIRED cert-red (#ff2d2d) — the Red Line, brought to life as the waveform.
const CLIP_RED = "0xFF2D2D";

// Compose the SHARE VIDEO clip: loop the burned-in still frame, paint an
// audio-reactive waveform (glowing cert-red `showwaves`) into the reserved band,
// and mux the chosen audio window underneath → a phone-ready H.264/AAC MP4
// (yuv420p + faststart so Reels / TikTok / IG ingest it cleanly). The waveform's
// MOTION is what makes the post read as "a song playing," not a static card.
//
//   framePath  the still PNG rendered by the app (cover + named credits + brand)
//   audioPath  a local audio file (the song's master); the window is grabbed here
//   band       { x, y, w, h } — where to paint the waveform (from the app frame)
//   startSeconds / durationSeconds — the audio window (`-shortest` trims a song
//              shorter than the window automatically)
export function renderShareClip({
  framePath,
  audioPath,
  band,
  startSeconds,
  durationSeconds,
  outPath,
  fps = 30,
}) {
  // A soft glow under the sharp waveform reads as energy (a song, alive). Scale
  // the blur to the band height so it looks right at either format.
  const sigma = Math.max(4, Math.round(band.h / 34));
  const filter = [
    `[1:a]aformat=channel_layouts=mono,` +
      `showwaves=s=${band.w}x${band.h}:mode=p2p:rate=${fps}:colors=${CLIP_RED}:scale=sqrt,` +
      `format=yuva420p,split[ws][wb]`,
    `[wb]gblur=sigma=${sigma}[wg]`,
    `[wg][ws]overlay=format=auto[wave]`,
    `[0:v]fps=${fps},format=yuva420p[bg]`,
    `[bg][wave]overlay=${band.x}:${band.y}:format=auto:shortest=1,format=yuv420p[v]`,
  ].join(";");

  const args = [
    "-hide_banner",
    "-nostdin",
    "-y",
    // Input 0: the still frame, looped into a video track.
    "-loop",
    "1",
    "-framerate",
    String(fps),
    "-i",
    framePath,
    // Input 1: the audio window (input-level -ss/-t reads only what's needed).
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-i",
    audioPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "1:a",
    // H.264 video — broad-compat baseline for social ingest.
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(fps),
    // AAC audio — the whole point: the song plays in-feed.
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "44100",
    "-movflags",
    "+faststart",
    "-shortest",
    outPath,
  ];

  return runFfmpeg(args);
}
