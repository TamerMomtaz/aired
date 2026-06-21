// Download one song for offline playback: enumerate its HLS segments, cache the
// manifest + every segment + the artwork, then write the IndexedDB snapshot LAST
// (its existence is the "fully downloaded" signal). No backend or schema change —
// everything here runs in the browser against the already-public bucket.

import { buildStreamUrl } from "@/lib/stream-url";

import { cacheUrls, deleteUrls } from "./cache";
import { deleteSnapshot, getSnapshot, putSnapshot } from "./db";
import { enumerateSegments } from "./manifest";
import {
  SNAPSHOT_SCHEMA,
  type OfflineContributor,
  type OfflineSnapshot,
} from "./types";

// The serializable payload a UI surface hands us to download a song. Mirrors the
// player Track plus the lyrics + catalog metadata the Downloads screen shows
// offline. A Server Component can build it directly from a work row.
export type DownloadInput = {
  id: number;
  title: string;
  hlsPlaylistKey: string | null;
  artworkUrl: string | null;
  durationSeconds: number | null;
  lyrics: string | null;
  contributors: OfflineContributor[];
};

export type DownloadProgress = (received: number, total: number) => void;

export async function downloadSong(
  input: DownloadInput,
  opts: { signal?: AbortSignal; onProgress?: DownloadProgress } = {},
): Promise<OfflineSnapshot> {
  const { signal, onProgress } = opts;

  const manifestUrl = buildStreamUrl(input.hlsPlaylistKey);
  if (!manifestUrl) throw new Error("This track isn't streaming yet.");

  // 1. Read the playlist and enumerate every segment as an absolute URL.
  const { manifests, segments } = await enumerateSegments(
    manifestUrl,
    async (url) => {
      const res = await fetch(url, { signal, mode: "cors" });
      if (!res.ok) throw new Error(`Couldn't read the playlist (HTTP ${res.status}).`);
      return res.text();
    },
  );
  if (segments.length === 0) throw new Error("This track has no audio yet.");

  const audioUrls = [...manifests, ...segments];
  const artworkUrl = input.artworkUrl;
  const total = audioUrls.length + (artworkUrl ? 1 : 0);
  const cachedUrls: string[] = [];
  let bytes = 0;

  try {
    // 2a. Manifest(s) + segments — required for playback. Progress is driven off
    //     these (they're the bulk of the bytes and the whole of the audio).
    bytes += await cacheUrls(audioUrls, {
      signal,
      onProgress: (done) => onProgress?.(done, total),
    });
    cachedUrls.push(...audioUrls);

    // 2b. Artwork — best-effort: a missing cover never fails a download (the
    //     Downloads screen just shows a placeholder offline).
    if (artworkUrl) {
      try {
        bytes += await cacheUrls([artworkUrl], { signal });
        cachedUrls.push(artworkUrl);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        // any other artwork failure is non-fatal — swallow it
      }
      onProgress?.(total, total);
    }
  } catch (err) {
    // Roll back partial writes so a cancelled/failed download leaves no orphans.
    await deleteUrls([...audioUrls, ...(artworkUrl ? [artworkUrl] : [])]).catch(
      () => {},
    );
    throw err;
  }

  // 3. Write the snapshot last.
  const snapshot: OfflineSnapshot = {
    id: input.id,
    title: input.title,
    artworkUrl: input.artworkUrl,
    durationSeconds: input.durationSeconds,
    lyrics: input.lyrics,
    contributors: input.contributors,
    hlsPlaylistKey: input.hlsPlaylistKey ?? "",
    manifestUrl,
    cachedUrls,
    segmentCount: segments.length,
    bytes,
    downloadedAt: Date.now(),
    schema: SNAPSHOT_SCHEMA,
  };
  await putSnapshot(snapshot);
  return snapshot;
}

// Delete a download: its cached entries (precisely what it added) and its
// snapshot. Safe to call for an unknown id.
export async function removeDownload(id: number): Promise<void> {
  const snap = await getSnapshot(id);
  if (snap) await deleteUrls(snap.cachedUrls).catch(() => {});
  await deleteSnapshot(id);
}
