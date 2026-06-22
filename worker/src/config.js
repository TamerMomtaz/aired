// All configuration comes from the environment (CLAUDE.md §1.7 — no hardcoded
// secrets). Non-secret reference values have baked-in defaults so a minimal
// deploy only needs to set the three secrets + the shared secret.

function getOptional(name, fallback) {
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? fallback : v;
}

function getRequired(name) {
  const v = process.env[name];
  if (v === undefined || v.trim() === "") {
    throw new Error(
      `Missing required env var: ${name}. See worker/.env.example for the full list.`,
    );
  }
  return v;
}

const r2AccountId = getOptional("R2_ACCOUNT_ID", "da822c931d669d9e250ed67ab8fd7323");

export const config = {
  port: Number(getOptional("PORT", "8080")),

  // Supabase — read the work row, sign a download URL for the private master.
  supabaseUrl: getOptional("SUPABASE_URL", "https://bfvgqvpoecakwintxhap.supabase.co"),
  supabaseServiceRoleKey: getRequired("SUPABASE_SERVICE_ROLE_KEY"),
  supabaseMastersBucket: getOptional("SUPABASE_MASTERS_BUCKET", "masters"),

  // Cloudflare R2 (S3-compatible) — store the master copy + the HLS rendition.
  r2AccountId,
  r2Endpoint: getOptional(
    "R2_ENDPOINT",
    `https://${r2AccountId}.r2.cloudflarestorage.com`,
  ),
  r2AccessKeyId: getRequired("R2_ACCESS_KEY_ID"),
  r2SecretAccessKey: getRequired("R2_SECRET_ACCESS_KEY"),
  r2MastersBucket: getOptional("R2_MASTERS_BUCKET", "aired-masters"),
  r2HlsBucket: getOptional("R2_HLS_BUCKET", "aired-hls"),

  // Shared secret guarding the HTTP endpoint. Validated by the server before it
  // listens (the CLI form does not need it), so it stays optional here.
  sharedSecret: getOptional("TRANSCODE_SHARED_SECRET", undefined),

  // The rendition (env-overridable, with the locked defaults from the brief).
  audioBitrate: getOptional("AUDIO_BITRATE", "192k"),
  hlsSegmentSeconds: Number(getOptional("HLS_SEGMENT_SECONDS", "6")),

  // SHARE VIDEO (clip.js) — the downloadable Reels / TikTok MP4 per song.
  // The app renders the burned-in still frame (cover + named credits + brand);
  // we fetch it from here, paint the waveform, mux the audio, cache in R2.
  appOrigin: getOptional("APP_ORIGIN", "https://ai-red.io").replace(/\/+$/, ""),
  // Clip frame rate. The audio WINDOW (start + length) is now per-song, read from
  // the work row and clamped in clip.js (brief: start ∈ [0, duration-5], length ∈
  // [20, 50]), so there are no global window env knobs anymore.
  clipFps: Number(getOptional("CLIP_FPS", "30")),
};
