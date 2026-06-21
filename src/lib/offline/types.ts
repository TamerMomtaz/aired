// Offline downloads — shared types.
//
// AIRED audio is public HLS (a playlist.m3u8 + many .ts segments on the public R2
// bucket). "Downloading" a song means caching its manifest + every segment + its
// artwork locally, and writing this SNAPSHOT to IndexedDB. The database and RLS
// are unreachable offline, so the snapshot is the SOLE source of truth for a
// downloaded work — the Downloads screen and the player render entirely from it.
//
// Contributor identity is carried verbatim (CLAUDE.md §3a: always public, always
// celebrated). No raw prompt, no style reference, nothing private is ever stored
// here — only the same public shapes the served pages already show.

export const SNAPSHOT_SCHEMA = 1;

export type OfflineContributor = { name: string; profile_slug: string | null };

export type OfflineSnapshot = {
  // The catalog number — doubles as the IndexedDB key.
  id: number;
  title: string;
  artworkUrl: string | null;
  durationSeconds: number | null;
  // The public lyrics, if the work has them, so they render offline too.
  lyrics: string | null;
  contributors: OfflineContributor[];
  // Playback wiring: the player resolves its stream URL from this key exactly as
  // it does online (buildStreamUrl), then hls.js pulls the manifest + segments —
  // which the service worker serves from the offline cache.
  hlsPlaylistKey: string;
  manifestUrl: string;
  // Every URL written to the offline cache for this work (manifest(s), segments,
  // artwork). Kept so removal can delete precisely what this download added.
  cachedUrls: string[];
  segmentCount: number;
  // Best-effort total bytes stored (for the Downloads screen's size readout).
  bytes: number;
  downloadedAt: number;
  schema: number;
};

// The reactive per-work state a Download control renders.
export type DownloadStatus = "idle" | "downloading" | "downloaded" | "error";

export type DownloadEntry = {
  status: DownloadStatus;
  // Items fetched / total items (manifest(s) + segments + artwork) while
  // downloading; both 0 otherwise.
  received: number;
  total: number;
  // A human-readable reason when status === "error" (e.g. out of storage).
  error?: string;
};
