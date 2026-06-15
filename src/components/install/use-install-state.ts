"use client";

import { useSyncExternalStore } from "react";

// Shared browser-state hooks for the install flow. Both the InstallCoach and
// the InstallTrigger need to know whether the app is already installed and
// whether the user dismissed the banner — usSyncExternalStore is the right
// React 19 primitive for that (it keeps a stable snapshot, plays nice with
// SSR, and avoids the cascading-render lint warning around initialising state
// from window inside useEffect).

export type Mode = "android" | "ios" | "none";

export type Platform = {
  mode: Mode;
  isStandalone: boolean;
};

const SSR_PLATFORM: Platform = { mode: "none", isStandalone: false };

let platformCache: Platform | null = null;

function computePlatform(): Platform {
  if (typeof window === "undefined") return SSR_PLATFORM;
  const standaloneMedia = window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone =
    "standalone" in window.navigator &&
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ua = window.navigator.userAgent;
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) &&
    !(window as Window & { MSStream?: unknown }).MSStream;
  return {
    mode: isIOS ? "ios" : "android",
    isStandalone: standaloneMedia || iosStandalone,
  };
}

function getPlatformSnapshot(): Platform {
  if (!platformCache) platformCache = computePlatform();
  return platformCache;
}

function subscribePlatform(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(display-mode: standalone)");
  const handler = () => {
    platformCache = null;
    onChange();
  };
  mq.addEventListener("change", handler);
  window.addEventListener("appinstalled", handler);
  return () => {
    mq.removeEventListener("change", handler);
    window.removeEventListener("appinstalled", handler);
  };
}

export function usePlatform(): Platform {
  return useSyncExternalStore(
    subscribePlatform,
    getPlatformSnapshot,
    () => SSR_PLATFORM,
  );
}

// Dismissal lives in localStorage so a "Not now" survives a page reload; the
// custom event lets the coach react when the dismissal flag is flipped from
// within the same tab (the native `storage` event only fires across tabs).

const DISMISS_KEY = "aired:install-coach-dismissed";
const DISMISS_CHANGE_EVENT = "aired:install-dismissed-changed";

let dismissedCache: boolean | null = null;

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  if (dismissedCache !== null) return dismissedCache;
  try {
    dismissedCache = window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    dismissedCache = false;
  }
  return dismissedCache;
}

function subscribeDismissed(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    dismissedCache = null;
    onChange();
  };
  window.addEventListener(DISMISS_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(DISMISS_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function useDismissed(): boolean {
  return useSyncExternalStore(
    subscribeDismissed,
    readDismissed,
    () => false,
  );
}

export function setDismissed(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (value) {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } else {
      window.localStorage.removeItem(DISMISS_KEY);
    }
  } catch {}
  dismissedCache = value;
  window.dispatchEvent(new Event(DISMISS_CHANGE_EVENT));
}

export const INSTALL_SHOW_EVENT = "aired:install-show";
