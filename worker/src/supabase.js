// Supabase access with the service-role key (bypasses RLS). Used to read the
// work row and to sign a short-lived download URL for the private master.

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

import { config } from "./config.js";

// This worker only does REST reads/updates and a signed-URL call — it never
// opens a realtime channel. supabase-js still constructs a RealtimeClient
// eagerly, and realtime-js aborts in that constructor when there is no native
// WebSocket (Node < 22). We hand it the `ws` package as the realtime transport
// so the client boots on any Node version without leaning on a global
// WebSocket; no socket is ever opened because we never subscribe.
export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  },
);

export async function getWork(workId) {
  const { data, error } = await supabase
    .from("work")
    .select(
      "id, title, status, duration_seconds, master_storage_path, audio_master_key, hls_playlist_key",
    )
    .eq("id", workId)
    .single();
  if (error) {
    throw new Error(`Could not read work ${workId}: ${error.message}`);
  }
  return data;
}

// Sign a temporary URL for the private master so it can be streamed straight to
// disk (avoids buffering a long master in memory).
export async function createMasterSignedUrl(path, expiresInSeconds = 600) {
  const { data, error } = await supabase.storage
    .from(config.supabaseMastersBucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Could not sign master URL for ${path}: ${error?.message ?? "no URL returned"}`,
    );
  }
  return data.signedUrl;
}

// Record the R2 keys on the work row. Status is intentionally left untouched
// (going live is Phase 4).
export async function updateWorkKeys(workId, { audioMasterKey, hlsPlaylistKey }) {
  const { error } = await supabase
    .from("work")
    .update({ audio_master_key: audioMasterKey, hls_playlist_key: hlsPlaylistKey })
    .eq("id", workId);
  if (error) {
    throw new Error(`Could not update work ${workId}: ${error.message}`);
  }
}

// Remove the private transcode source from Supabase Storage (EDIT & TIDY —
// Discard). Service-role, so it isn't bound by Storage RLS. Best-effort: a
// missing object is not an error worth failing the purge over (the row is
// already gone), so the caller logs and continues.
export async function deleteMasterObject(path) {
  if (!path) return { removed: 0 };
  const { error } = await supabase.storage
    .from(config.supabaseMastersBucket)
    .remove([path]);
  if (error) {
    throw new Error(`Could not delete master ${path}: ${error.message}`);
  }
  return { removed: 1 };
}
