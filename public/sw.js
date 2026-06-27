// AIRED service worker — installability, a faster shell, and OFFLINE DOWNLOADS.
//
// Four jobs, in priority order on the fetch path:
//
//   1. DOWNLOADED AUDIO. A song is "downloaded" when the page has cached its HLS
//      manifest + every .ts segment + its artwork into the offline cache (see
//      src/lib/offline/*). For those cross-origin R2 / Supabase URLs we serve the
//      cached copy when present — so a downloaded song plays with NO network, and
//      online playback of a downloaded song skips the re-fetch (faster). A miss
//      falls straight through to the network, exactly as before.
//
//   2. RSC / FLIGHT REQUESTS — NETWORK-ONLY, NEVER CACHED. A React Server
//      Component payload (a request with `?_rsc=…`, the `RSC: 1` header, or
//      `Accept: text/x-component`) is NOT an HTML document. If one is ever cached
//      under a route key and later replayed to a top-level navigation, the
//      browser paints the raw Flight stream as text — that is the "garbled text
//      on PWA launch" bug. So RSC requests always hit the network untouched and
//      are never written to or read from any cache. Offline, the RSC fetch simply
//      fails and Next falls back to a hard navigation, which job 3 handles.
//
//   3. APP NAVIGATIONS, offline-tolerant. Top-level navigations go network-FIRST
//      — a signed-in user always sees fresh data online — but when the network is
//      gone we fall back to a cached *HTML document* copy, and finally to the
//      Downloads screen, so the app lands on a calm offline state instead of a
//      browser error. Only PUBLIC routes are ever runtime-cached (never /manage,
//      /upload, /settings, /review, /auth), and only genuine `text/html`
//      responses — never a Flight payload — so this can never stash raw RSC.
//
//   4. IMMUTABLE BUILD ASSETS. /_next/static/ is content-hashed → cache-first
//      forever (swept on a version bump), as before.
//
// Conservative by default: anything not matched here hits the network untouched
// (Supabase API, auth, RSC, every non-GET).

// Versioned caches — bumped to roll the worker. The activate sweep deletes every
// cache NOT in KEEP, so old versions clear on the next visit. The bump to v3 also
// purges any v2 runtime cache that an older worker may have poisoned with an RSC
// payload, so existing installs self-heal on their next launch.
const STATIC_CACHE = "aired-static-v3";
const RUNTIME_CACHE = "aired-runtime-v3";
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

  // 2) RSC / Flight requests: NETWORK-ONLY. Never cached, never served from cache
  //    — replaying a Flight payload to a navigation is what paints raw text on
  //    launch. Returning without respondWith lets the browser fetch it normally;
  //    offline it fails and Next falls back to a hard navigation (handled below).
  if (isRscRequest(req, url)) return;

  // 4) Immutable Next build assets: cache-first forever.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // 3) Top-level navigations: network-first, with an HTML-only offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(navigateNetworkFirst(req, url));
    return;
  }

  // Everything else same-origin (icons, route handlers, images): pass through.
});

// True for any React Server Component / Flight fetch. Next marks these with a
// cache-busting `_rsc` query param, the `RSC: 1` header, and an
// `Accept: text/x-component`. A real top-level navigation carries none of these,
// so this never misclassifies a document request.
function isRscRequest(request, url) {
  if (url.searchParams.has("_rsc")) return true;
  if (request.headers.get("RSC") === "1") return true;
  const accept = request.headers.get("Accept") || "";
  return accept.includes("text/x-component");
}

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

// Network-first for top-level navigations, falling back to cache only when the
// network is gone. A successful response is stashed ONLY when it's a PUBLIC route
// AND a genuine HTML document — so the runtime cache can never hold a Flight
// payload, and an offline launch always paints HTML, never raw text. Keyed by the
// navigation request; since RSC is never cached, no key collision is possible.
async function navigateNetworkFirst(request, url) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (
      response &&
      response.ok &&
      isCacheableRoute(url.pathname) &&
      isHtmlDocument(response)
    ) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached) return cached;
    const fallback = await cache.match(OFFLINE_FALLBACK, { ignoreVary: true });
    if (fallback) return fallback;
    throw err;
  }
}

// Only ever treat a real HTML document as cacheable shell. A Flight response is
// `text/x-component`; gating on `text/html` keeps it out of the cache even if the
// request-side RSC check above ever misses an edge case.
function isHtmlDocument(response) {
  const type = response.headers.get("Content-Type") || "";
  return type.includes("text/html");
}
