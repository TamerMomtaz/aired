// Can this device reliably DOWNLOAD and PLAY a song offline?
//
// The hard requirement is that playback runs through hls.js on Media Source
// Extensions: the service worker serves cached segments to hls.js's own fetches,
// but it CANNOT feed iOS Safari's native HLS player (which fetches media outside
// the SW). iPhones lack MSE and force native HLS, so they fail this check;
// iPadOS / desktop Safari have MSE and pass; iOS 17+'s ManagedMediaSource — which
// hls.js can drive — also passes. This is the "detect capability and disable where
// it genuinely can't work, rather than promising what iOS can't deliver" gate.

export type OfflineCapability = {
  ok: boolean;
  reason?: "unsupported-device" | "no-storage";
};

export function detectCapability(): OfflineCapability {
  if (typeof window === "undefined") {
    return { ok: false, reason: "unsupported-device" };
  }
  const hasStorage =
    "caches" in window && "indexedDB" in window && "serviceWorker" in navigator;
  if (!hasStorage) return { ok: false, reason: "no-storage" };

  const hasMse = "MediaSource" in window || "ManagedMediaSource" in window;
  if (!hasMse) return { ok: false, reason: "unsupported-device" };

  return { ok: true };
}

// A short, honest line for a disabled control.
export function capabilityNote(cap: OfflineCapability): string {
  if (cap.reason === "no-storage") {
    return "This browser can't store downloads.";
  }
  return "Offline downloads aren't supported on this device yet.";
}
