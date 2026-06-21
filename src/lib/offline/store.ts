"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { Track } from "@/components/player/track";

import { clearOfflineCache } from "./cache";
import { detectCapability, type OfflineCapability } from "./capability";
import { clearSnapshots, getAllSnapshots } from "./db";
import {
  downloadSong,
  removeDownload as removeDownloadFiles,
  type DownloadInput,
} from "./download";
import type { DownloadEntry, OfflineSnapshot } from "./types";

// The reactive heart of offline downloads. ONE module-level store, read by every
// surface (the per-song button, the now-playing bar, the Downloads screen) via
// useSyncExternalStore — the same React-19 primitive the install flow already uses
// (src/components/install/use-install-state.ts), chosen for stable snapshots and
// SSR safety. The store owns:
//   - `entries`   : per-work status + progress (what a Download control renders)
//   - `snapshots` : the downloaded library (what the Downloads screen lists)
//   - `controllers`: in-flight AbortControllers, so a download can be cancelled
// Everything that touches IndexedDB / Cache Storage / navigator runs only in
// browser code paths (handlers + effects), never at module load, so SSR is clean.

const IDLE: DownloadEntry = Object.freeze({
  status: "idle",
  received: 0,
  total: 0,
});
const EMPTY: readonly OfflineSnapshot[] = Object.freeze([]);

const entries = new Map<number, DownloadEntry>();
const controllers = new Map<number, AbortController>();
let snapshots: OfflineSnapshot[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getEntry(id: number): DownloadEntry {
  return entries.get(id) ?? IDLE;
}

function setEntry(id: number, entry: DownloadEntry) {
  entries.set(id, entry);
  emit();
}

function setSnapshots(next: OfflineSnapshot[]) {
  snapshots = next;
  emit();
}

// ---- hydration: read the downloaded library once, on the client ----------
let hydrated = false;
let hydrating: Promise<void> | null = null;

async function hydrate() {
  const all = await getAllSnapshots();
  for (const s of all) {
    if (!entries.has(s.id)) {
      entries.set(s.id, { status: "downloaded", received: 0, total: 0 });
    }
  }
  snapshots = all;
  hydrated = true;
  emit();
}

export function ensureHydrated() {
  if (typeof window === "undefined" || hydrated || hydrating) return;
  hydrating = hydrate()
    // A broken IDB must not crash the app — downloads just appear empty.
    .catch(() => {})
    .finally(() => {
      hydrating = null;
    });
}

// Request durable storage ONCE, the first time the user actually downloads, so the
// OS won't silently evict downloads under pressure. Best-effort: a denial just
// means eviction stays possible, and the user can re-download.
let persistRequested = false;
function requestPersistence() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {
    // not supported — ignore
  }
}

// ---- actions -------------------------------------------------------------
export async function startDownload(input: DownloadInput): Promise<void> {
  if (typeof window === "undefined") return;
  if (getEntry(input.id).status === "downloading") return;
  requestPersistence();

  const controller = new AbortController();
  controllers.set(input.id, controller);
  setEntry(input.id, { status: "downloading", received: 0, total: 0 });

  try {
    const snap = await downloadSong(input, {
      signal: controller.signal,
      onProgress: (received, total) =>
        setEntry(input.id, { status: "downloading", received, total }),
    });
    // Library: replace any prior copy, newest first.
    setSnapshots([snap, ...snapshots.filter((s) => s.id !== snap.id)]);
    setEntry(input.id, { status: "downloaded", received: 0, total: 0 });
    // Warm the Downloads route so it's reachable on a later cold offline launch
    // (the service worker caches the navigation response).
    void fetch("/downloads", { cache: "no-store" }).catch(() => {});
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Cancelled — back to a plain Download control and clear any partial state.
      entries.delete(input.id);
      emit();
    } else {
      setEntry(input.id, {
        status: "error",
        received: 0,
        total: 0,
        error: err instanceof Error ? err.message : "Download failed.",
      });
    }
  } finally {
    controllers.delete(input.id);
  }
}

export function cancelDownload(id: number) {
  controllers.get(id)?.abort();
}

export async function deleteDownload(id: number): Promise<void> {
  await removeDownloadFiles(id).catch(() => {});
  setSnapshots(snapshots.filter((s) => s.id !== id));
  entries.delete(id);
  emit();
}

export async function clearAllDownloads(): Promise<void> {
  for (const c of controllers.values()) c.abort();
  await clearSnapshots().catch(() => {});
  await clearOfflineCache().catch(() => {});
  snapshots = [];
  entries.clear();
  emit();
}

// ---- hooks ---------------------------------------------------------------
export function useDownloadEntry(id: number): DownloadEntry {
  useEffect(() => {
    ensureHydrated();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => getEntry(id),
    () => IDLE,
  );
}

export function useDownloads(): {
  snapshots: OfflineSnapshot[];
  hydrated: boolean;
} {
  useEffect(() => {
    ensureHydrated();
  }, []);
  const snaps = useSyncExternalStore(
    subscribe,
    () => snapshots,
    () => EMPTY as OfflineSnapshot[],
  );
  return { snapshots: snaps, hydrated };
}

export type StorageReport = { usage: number; quota: number };

// Whole-origin storage usage + quota (navigator.storage.estimate). Recomputed
// whenever `dep` changes — pass the downloads list so the readout tracks the
// library growing and shrinking.
export function useStorageEstimate(dep: unknown): StorageReport | null {
  const [report, setReport] = useState<StorageReport | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!navigator.storage?.estimate) return;
        const { usage, quota } = await navigator.storage.estimate();
        if (alive) setReport({ usage: usage ?? 0, quota: quota ?? 0 });
      } catch {
        // estimate unsupported — leave it null
      }
    })();
    return () => {
      alive = false;
    };
  }, [dep]);
  return report;
}

// Whether this device can do offline downloads at all — a device-static fact, read
// through useSyncExternalStore (not useState-in-effect) so it stays SSR-safe and
// hydration-clean, mirroring the install-state hooks. The first client render
// matches the server (the conservative "unsupported" snapshot), then settles to
// the real capability once mounted.
let capabilityCache: OfflineCapability | null = null;
const SSR_CAPABILITY: OfflineCapability = {
  ok: false,
  reason: "unsupported-device",
};

function getCapabilitySnapshot(): OfflineCapability {
  if (!capabilityCache) capabilityCache = detectCapability();
  return capabilityCache;
}

function subscribeCapability(): () => void {
  return () => {}; // device-static — never changes within a session
}

export function useCapability(): OfflineCapability {
  return useSyncExternalStore(
    subscribeCapability,
    getCapabilitySnapshot,
    () => SSR_CAPABILITY,
  );
}

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

// A player Track built straight from an offline snapshot — no DB needed. The
// player resolves its stream URL from hlsPlaylistKey exactly as online, and the
// service worker feeds hls.js the cached manifest + segments.
export function trackFromSnapshot(s: OfflineSnapshot): Track {
  return {
    id: s.id,
    title: s.title,
    hlsPlaylistKey: s.hlsPlaylistKey,
    artworkUrl: s.artworkUrl,
    durationSeconds: s.durationSeconds,
    contributors: s.contributors,
  };
}

export type { DownloadInput } from "./download";
