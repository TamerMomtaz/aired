// AIRED service worker — installability, a faster shell, and OFFLINE DOWNLOADS.
//
// Three jobs, in priority order on the fetch path:
//
//   1. DOWNLOADED AUDIO. A song is "downloaded" when the page has cached its HLS
//      manifest + every .ts segment + its artwork into the offline cache (see
//      src/lib/offline/*). For those cross-origin R2 / Supabase URLs we serve the
//      cached copy when present — so a downloaded song plays with NO network, and
//      online playback of a downloaded song skips the re-fetch (faster). A miss
//      falls straight through to the network, exactly as before.
//
//   2. APP SHELL, offline-tolerant. Page navigations (and Next's RSC fetches) go
//      network-FIRST — a signed-in user always sees fresh data online — but when
//      the network is gone we fall back to a cached copy, and finally to the
//      Downloads screen, so the app lands on a calm offline state instead of a
//      browser error. Only PUBLIC routes are ever runtime-cached (never /manage,
//      /upload, /settings, /review, /auth), so this never stashes private pages.
//
//   3. IMMUTABLE BUILD ASSETS. /_next/static/ is content-hashed → cache-first
//      forever (swept on a version bump), as before.
//
// Conservative by default: anything not matched here hits the network untouched
// (Supabase API, auth, every non-GET).

// Versioned caches — bumped to roll the worker. The activate sweep deletes every
// cache NOT in KEEP, so old versions clear on the next visit.
const STATIC_CACHE = "aired-static-v2";
const RUNTIME_CACHE = "aired-runtime-v2";
// The downloads cache is UNVERSIONED on purpose: it holds the listener's actual
// downloaded songs and must survive every deploy. Kept out of the sweep below.
// MUST match OFFLINE_CACHE in src/lib/offline/cache.ts.
const OFFLINE_CACHE = "aired-offline-v1";

// Precached so the Downloads screen is reachable on a cold offline launch.
const OFFLINE_FALLBACK = "/downloads";

const KEEP = new Set([STATIC_CACHE, RUNTIME_CACHE, OFFLINE_CACHE]);

// Public routes that are safe to runtime-cache for offline fallback. Authenticated
// / owner surfaces are deliberately excluded (CLAUDE.md: never serve a stale shell
// of someone's private page).
function isCacheableRoute(pathname) {
  if (pathname === "/" || pathname === "/downloads") return true;
  return (
    pathname.startsWith("/registry") ||
    pathname.startsWith("/album") ||
    pathname.startsWith("/artist") ||
    pathname.startsWith("/agent") ||
    pathname.startsWith("/cert")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(RUNTIME_CACHE);
        // `reload` so the precache copy comes from the network, not the HTTP cache.
        await cache.add(new Request(OFFLINE_FALLBACK, { cache: "reload" }));
      } catch {
        // Best-effort: the runtime fetch path will populate it on first visit.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !KEEP.has(name)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "unregister") {
    self.registration.unregister().catch(() => {});
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Never touch non-GETs — sign in, upload, ledger writes always hit the network.
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // 1) Cross-origin (R2 audio, Supabase artwork, fonts, analytics): serve from the
  //    downloads cache when present, else proxy to the network exactly as the
  //    browser would. This is what makes a downloaded song play offline.
  if (url.origin !== self.location.origin) {
    event.respondWith(offlineFirst(req));
    return;
  }

  // Keep the worker file + manifest live so a deploy can always change them.
  if (url.pathname === "/sw.js" || url.pathname === "/manifest.webmanifest") return;

  // Never cache anything touching auth.
  if (url.pathname.startsWith("/auth/")) return;

  // 3) Immutable Next build assets: cache-first forever.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // 2) App navigations + Next RSC fetches: network-first with an offline fallback.
  const isNav = req.mode === "navigate";
  const isRsc =
    req.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  if (isNav || isRsc) {
    event.respondWith(networkFirstApp(req, url, isNav, isRsc));
    return;
  }

  // Everything else same-origin (icons, route handlers, images): pass through.
});

// Serve a cross-origin GET from the offline cache if we have it; otherwise go to
// the network. On a miss while offline the fetch rejects, which is the correct
// outcome (a song that wasn't downloaded simply can't play offline).
async function offlineFirst(request) {
  const cache = await caches.open(OFFLINE_CACHE);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  return fetch(request);
}

// Cache-first for immutable, content-hashed assets.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

// Network-first for app pages / RSC, falling back to cache when offline. Successful
// responses for PUBLIC routes are stashed for that fallback; RSC URLs are
// normalized (the cache-busting `_rsc` query dropped) so the offline match hits.
async function networkFirstApp(request, url, isNav, isRsc) {
  const cache = await caches.open(RUNTIME_CACHE);
  const key = isRsc ? rscKey(url) : request;
  try {
    const response = await fetch(request);
    if (response && response.ok && isCacheableRoute(url.pathname)) {
      cache.put(key, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(key, { ignoreVary: true });
    if (cached) return cached;
    if (isNav) {
      const fallback = await cache.match(OFFLINE_FALLBACK, { ignoreVary: true });
      if (fallback) return fallback;
    }
    throw err;
  }
}

// A stable cache key for an RSC request: same URL minus the `_rsc` cache-buster.
function rscKey(url) {
  const u = new URL(url.href);
  u.searchParams.delete("_rsc");
  return u.toString();
}
