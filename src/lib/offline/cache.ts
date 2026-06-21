// Cache Storage helpers for offline downloads.
//
// Downloaded songs live in ONE dedicated, UNVERSIONED cache so a service-worker
// update never sweeps them (public/sw.js keeps this name in its activate
// allow-list). The name MUST stay in lock-step with the OFFLINE_CACHE constant in
// public/sw.js — the worker reads this very cache to serve a downloaded song.
//
// v1 stores the public segments as-is: no encryption. The audio is already openly
// fetchable from the public bucket, so local encryption would add real complexity
// for little gain (CLAUDE.md / task: leave the seam, don't build the lock yet).
export const OFFLINE_CACHE = "aired-offline-v1";

export type CacheProgress = (done: number, total: number) => void;

// Fetch each URL into the offline cache, in order, reporting progress and honoring
// an abort signal. Returns best-effort total bytes stored. Already-cached URLs are
// skipped, so a re-download (or resume after a failed attempt) is cheap and
// idempotent. Throws on the first hard failure — with a friendly message on
// QuotaExceededError — so the caller can roll back and surface it.
export async function cacheUrls(
  urls: string[],
  opts: { signal?: AbortSignal; onProgress?: CacheProgress } = {},
): Promise<number> {
  const { signal, onProgress } = opts;
  const cache = await caches.open(OFFLINE_CACHE);
  let bytes = 0;
  let done = 0;
  for (const url of urls) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const existing = await cache.match(url);
    if (existing) {
      bytes += await sizeOf(existing);
    } else {
      const res = await fetch(url, { signal, mode: "cors" });
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
      // The body is consumable once — clone before the cache takes ownership so we
      // can still measure it.
      const measure = res.clone();
      try {
        await cache.put(url, res);
      } catch (err) {
        if (err instanceof DOMException && err.name === "QuotaExceededError") {
          throw new Error("Out of storage — free up space and try again.");
        }
        throw err;
      }
      bytes += await sizeOf(measure);
    }
    done += 1;
    onProgress?.(done, urls.length);
  }
  return bytes;
}

async function sizeOf(res: Response): Promise<number> {
  const len = res.headers.get("content-length");
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n > 0) return n;
  }
  try {
    return (await res.blob()).size;
  } catch {
    return 0;
  }
}

export async function deleteUrls(urls: string[]): Promise<void> {
  const cache = await caches.open(OFFLINE_CACHE);
  await Promise.all(urls.map((u) => cache.delete(u)));
}

export async function clearOfflineCache(): Promise<void> {
  await caches.delete(OFFLINE_CACHE);
}
