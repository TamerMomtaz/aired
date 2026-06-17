"use client";

import { useSyncExternalStore } from "react";

// The single source of truth for the first-visit onboarding flag.
//
// Per the platform's storage discipline we keep exactly ONE browser-storage
// key — "aired_onboarded" — and nothing else. The overlay reads it to decide
// whether a brand-new visitor sees the intro; completing (or skipping) the flow
// sets it so it never shows again. The footer's "intro" link clears it and
// fires a replay event so the overlay (mounted once in the root layout) can
// re-open in place — no full reload, no second key.
//
// Reads go through useSyncExternalStore (the same React 19 primitive the
// install flow uses): a stable server snapshot keeps SSR + hydration agreeing
// that nothing shows, then the store settles to the real flag on the client —
// no hydration flash and no setState-in-effect.

const ONBOARDED_KEY = "aired_onboarded";
const ONBOARDING_CHANGE_EVENT = "aired:onboarding-changed";
export const ONBOARDING_REPLAY_EVENT = "aired:onboarding-replay";

let cache: boolean | null = null;

function readOnboarded(): boolean {
  if (typeof window === "undefined") return true;
  if (cache !== null) return cache;
  try {
    cache = window.localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    // Storage blocked (private mode / disabled cookies). Treat as a fresh
    // visitor — they see the intro this session; it just can't be remembered.
    cache = false;
  }
  return cache;
}

function subscribeOnboarded(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => {
    cache = null;
    onChange();
  };
  window.addEventListener(ONBOARDING_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(ONBOARDING_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// Server + first client render report "onboarded" (show nothing); the store
// then settles to the real value on the client.
export function useOnboarded(): boolean {
  return useSyncExternalStore(subscribeOnboarded, readOnboarded, () => true);
}

export function markOnboarded(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // Storage blocked — the overlay still closes for this session.
  }
  cache = true;
  window.dispatchEvent(new Event(ONBOARDING_CHANGE_EVENT));
}

export function replayOnboarding(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ONBOARDED_KEY);
  } catch {
    // Nothing to clear / storage blocked — the events below still re-open it.
  }
  cache = false;
  window.dispatchEvent(new Event(ONBOARDING_CHANGE_EVENT));
  window.dispatchEvent(new Event(ONBOARDING_REPLAY_EVENT));
}

// prefers-reduced-motion as a store too, so the overlay can branch in render
// (static pills, no pixel storm) without a mount effect.
function readReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    () => false,
  );
}
