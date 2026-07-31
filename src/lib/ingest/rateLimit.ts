// A guardrail on signed upload grants — not a security boundary.
//
// WHAT IT IS FOR. A grant is cheap to ask for and creates a writable slot in the
// private bucket. A runaway loop or a buggy client could mint thousands and fill
// `masters` with objects no work will ever reference. This bounds that. It does
// NOT defend against a hostile holder of a valid token: that token already opens
// the ingest door, and the real answer there is to rotate it.
//
// HOW IT COUNTS. A fixed window per token identity — `<authority>:<label>`, which
// names the token without ever touching the secret. Fixed windows can allow up to
// 2× the limit across a window boundary; at this ceiling that is irrelevant, and
// the alternative (sliding window) is more state for no benefit here.
//
// THE HONEST CAVEAT. The counter lives in module memory, so it is PER SERVERLESS
// INSTANCE. Vercel may run several concurrently and recycles them on cold start,
// so the effective global ceiling is the limit times the number of warm
// instances, and a quiet period can reset it early. That is a deliberate
// trade — it needs no table, no migration, and no external service, and it still
// stops the failure mode this exists for (one client looping). If a hard global
// ceiling is ever needed, this module is the seam: swap the store for a table or
// a KV counter and every caller keeps working.
//
// THE LIMIT IS CHOSEN TO BE UNREACHABLE BY REAL WORK. One song = one grant. A
// twenty-track album with a retry on every track = ~40. Sixty per hour leaves
// room above any human publishing session, so a normal one-song publish can
// never be impeded by it.
//
// SERVER ONLY.

import type { DelegatedGrant } from "./tokens";

/** Grants per token per window. One publish needs one. */
export const GRANT_LIMIT = 60;
/** The window, in milliseconds. */
export const GRANT_WINDOW_MS = 60 * 60 * 1000;

/** Above this many tracked tokens, expired entries are swept on the next call. */
const SWEEP_THRESHOLD = 512;

export type RateWindow = { windowStartMs: number; count: number };
export type RateStore = Map<string, RateWindow>;

export type RateDecision =
  | { allowed: true; limit: number; remaining: number; resetAtMs: number }
  | {
      allowed: false;
      limit: number;
      remaining: 0;
      resetAtMs: number;
      retryAfterSeconds: number;
    };

// The process-wide store. Exported only so a test can inspect or reset it.
export const grantRateStore: RateStore = new Map();

/**
 * The token's identity for counting: the human authority it carries plus its
 * label. Never the secret, and never a hash of it — this string may safely
 * appear in a server log line.
 */
export function tokenRateKey(grant: DelegatedGrant): string {
  return `${grant.authorityProfileId}:${grant.label}`;
}

function sweep(store: RateStore, now: number): void {
  for (const [key, window] of store) {
    if (now - window.windowStartMs >= GRANT_WINDOW_MS) store.delete(key);
  }
}

/**
 * Count one grant against `key` and say whether it is allowed.
 *
 * Pure apart from the store it is handed, so the whole policy is testable
 * without a clock or a network: pass `now` and your own store.
 */
export function checkGrantRate(
  key: string,
  now: number = Date.now(),
  store: RateStore = grantRateStore,
  limit: number = GRANT_LIMIT,
): RateDecision {
  if (store.size > SWEEP_THRESHOLD) sweep(store, now);

  const existing = store.get(key);
  const window: RateWindow =
    !existing || now - existing.windowStartMs >= GRANT_WINDOW_MS
      ? { windowStartMs: now, count: 0 }
      : existing;

  const resetAtMs = window.windowStartMs + GRANT_WINDOW_MS;

  if (window.count >= limit) {
    // Refused: the count is NOT incremented, so hammering the endpoint while
    // limited cannot push the window's reset further away.
    store.set(key, window);
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAtMs,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - now) / 1000)),
    };
  }

  window.count += 1;
  store.set(key, window);
  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - window.count),
    resetAtMs,
  };
}
