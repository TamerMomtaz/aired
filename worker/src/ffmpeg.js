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
//   nice        run under `nice -n <n>` so a long render yields the CPU to the
//               upload transcodes (CLAUDE.md §1.5 — uploads go live in minutes)
//   onProgress  called with seconds of output written; the args must include
//               `-progress pipe:1` for ffmpeg to report it on stdout
//   stdout      true → resolve with stdout as a Buffer (a raw-pixel probe)
function runFfmpeg(args, { cwd, nice = 0, onProgress, stdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const [cmd, argv] = nice > 0 ? ["nice", ["-n", String(nice), "ffmpeg", ...args]] : ["ffmpeg", args];
    const proc = spawn(cmd, argv, cwd ? { cwd } : undefined);
    let stderr = "";
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-500_000);
    });
    const out = [];
    let pending = "";
    proc.stdout.on("data", (d) => {
      if (stdout) out.push(d);
      if (!onProgress) return;
      pending += d.toString();
      let nl;
      while ((nl = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, nl).trim();
        pending = pending.slice(nl + 1);
        // out_time_us is microseconds; some builds misname it out_time_ms.
        const m = /^out_time_(?:us|ms)=(\d+)$/.exec(line);
        if (m) onProgress(Number(m[1]) / 1e6);
      }
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to start ffmpeg (is it installed?): ${err.message}`)),
    );
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout ? Buffer.concat(out) : undefined);
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

// ── REELS (reel.js) ─────────────────────────────────────────────────────────

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Paths reach -filter_complex as text, which ffmpeg parses twice (filtergraph,
// then filter options), so escaping is two-level and easy to get wrong. The
// worker controls both paths (a bare file name in its temp dir, and the fonts
// directory), so instead of escaping we refuse the metacharacters outright.
function filterPath(value) {
  if (/[[\],;'\\:]/.test(value)) {
    throw new Error(`path "${value}" has a character ffmpeg's filtergraph can't take ([],;':\\)`);
  }
  return value;
}

// The multiplier the scrim applies at row Y: an overall dim, deepened by soft
// Gaussian bands behind the lyric and caption zones (reel-layout.js `scrim`).
function scrimExpr({ dim, bands }) {
  return [
    String(dim),
    ...bands.map(
      (b) => `(1-${b.strength}*exp(-pow((Y-${b.cy})/${b.sigma},2)))`,
    ),
  ].join("*");
}

// Prepare the reel's background ONCE, as a still: the artwork scaled to cover a
// frame a little wider than the output (room for the drift), softly blurred,
// and dimmed by the scrim so off-white type always reads. With no artwork (or
// artwork ffmpeg can't read) the field is AIRED near-black with a faint red
// warmth behind the lyric zone. Returns the still's width.
export async function prepareReelBackground({
  artPath,
  outPath,
  width,
  height,
  overscan,
  scrim,
}) {
  const ow = even(width * (1 + overscan));
  const oh = height;
  const k = scrimExpr(scrim);
  if (artPath) {
    const sigma = Math.max(4, Math.round(width / 110));
    try {
      await runFfmpeg([
        "-hide_banner", "-nostdin", "-y",
        "-i", artPath,
        "-frames:v", "1",
        "-vf",
        `scale=${ow}:${oh}:force_original_aspect_ratio=increase:flags=lanczos,crop=${ow}:${oh},` +
          `gblur=sigma=${sigma},eq=saturation=1.08,format=rgb24,` +
          `geq=r='r(X,Y)*${k}':g='g(X,Y)*${k}':b='b(X,Y)*${k}'`,
        outPath,
      ]);
      return ow;
    } catch {
      // Unreadable artwork falls through to the branded field — never a failed reel.
    }
  }
  const lyricBand = scrim.bands[0];
  const glow = `exp(-pow((Y-${lyricBand.cy})/${Math.round(oh * 0.3)},2)-pow((X-${ow / 2})/${Math.round(ow * 0.55)},2))`;
  await runFfmpeg([
    "-hide_banner", "-nostdin", "-y",
    "-f", "lavfi",
    "-i", `color=c=0x0a0a0a:s=${ow}x${oh}:d=1`,
    "-frames:v", "1",
    "-vf", `format=rgb24,geq=r='10+30*${glow}':g='10+6*${glow}':b='10+6*${glow}'`,
    outPath,
  ]);
  return ow;
}

// Mean luma (0–255) of a rectangle of an image — decides whether the corner
// lockup reads better in off-white or in ink over this particular cover.
export async function measureLuma(imagePath, { x, y, w, h }) {
  const buf = await runFfmpeg(
    [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      "-i", imagePath,
      "-frames:v", "1",
      "-vf", `crop=${even(w)}:${even(h)}:${Math.round(x)}:${Math.round(y)},scale=1:1:flags=area,format=gray`,
      "-f", "rawvideo",
      "pipe:1",
    ],
    { stdout: true },
  );
  return buf.length ? buf[0] : 0;
}

// Compose a REEL: the prepared background drifting slowly sideways (a
// Ken-Burns pan — horizontal, eased, one sweep per `panPeriod` seconds), the
// ASS layer burned in with libass (lyrics, title card, caption, Red Line,
// lockup), and the song's audio window underneath → H.264/AAC MP4, yuv420p +
// faststart. Runs in `cwd` so the ASS file is referenced by a bare name.
//
//   bgPath / bgWidth   the prepared still and its (overscanned) width
//   assFile            the ASS script's filename inside cwd
//   fontsDir           Geist + Tajawal (CJK comes from the system's Noto CJK)
//   startSeconds / durationSeconds   the audio window
//   fadeIn / fadeOut   soften a window that opens / ends mid-song
//   crf / maxrate      quality; maxrate caps a 12-minute file's size
export function renderReel({
  cwd,
  bgPath,
  bgWidth,
  assFile,
  fontsDir,
  audioPath,
  startSeconds,
  durationSeconds,
  width,
  height,
  fps,
  panPeriod,
  crf,
  maxrate,
  fadeIn,
  fadeOut,
  outPath,
  onProgress,
}) {
  const pan =
    bgWidth > width
      ? `crop=${width}:${height}:x='(iw-ow)*(0.5-0.5*cos(2*PI*t/${panPeriod}))':y=0`
      : `crop=${width}:${height}:0:0`;
  const audio = ["aformat=channel_layouts=stereo"];
  if (fadeIn) audio.push("afade=t=in:st=0:d=0.3");
  if (fadeOut && durationSeconds > 4) {
    audio.push(`afade=t=out:st=${(durationSeconds - 1.5).toFixed(2)}:d=1.5`);
  }
  const filter = [
    `[0:v]${pan},ass=filename=${filterPath(assFile)}:fontsdir=${filterPath(fontsDir)},format=yuv420p[v]`,
    `[1:a]${audio.join(",")}[a]`,
  ].join(";");

  const args = [
    "-hide_banner", "-nostdin", "-y",
    "-loop", "1",
    "-framerate", String(fps),
    "-i", bgPath,
    "-ss", String(startSeconds),
    "-t", String(durationSeconds),
    "-i", audioPath,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "[a]",
    "-t", String(durationSeconds),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", String(crf),
    ...(maxrate ? ["-maxrate", maxrate, "-bufsize", `${parseInt(maxrate, 10) * 2}M`] : []),
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-g", String(fps * 2),
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "44100",
    "-movflags", "+faststart",
    "-shortest",
    "-progress", "pipe:1",
    "-nostats",
    outPath,
  ];
  return runFfmpeg(args, { cwd, nice: 10, onProgress });
}

// A media file's duration in seconds (ffprobe), or null if it can't be read —
// a FULL reel of a song whose duration_seconds isn't recorded yet sizes itself
// from the master instead.
export function probeDuration(path) {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const n = Number.parseFloat(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}
