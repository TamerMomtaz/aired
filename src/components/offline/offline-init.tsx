"use client";

import { useEffect } from "react";

import { ensureHydrated } from "@/lib/offline/store";

// Mounted once in the app shell. It warms the offline store from IndexedDB on
// load so "Downloaded ✓" states resolve promptly everywhere (the song page, the
// now-playing bar) without waiting for a Download control to mount. Renders
// nothing; all browser access is guarded inside ensureHydrated.
export function OfflineInit() {
  useEffect(() => {
    ensureHydrated();
  }, []);
  return null;
}
