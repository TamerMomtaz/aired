// AIRED service worker — the minimum needed to make the app installable
// (Chrome/Android one-tap install requires a SW with a fetch handler) and
// nothing more. The classic way to break a working web app is an over-eager
// service worker, so this one is deliberately small:
//
//   - Auth flows, Supabase calls, R2/HLS audio, and any cross-origin or
//     non-GET request are never cached.
//   - Page navigations go network-first (we never want a stale shell shown to
//     a signed-in user looking at someone else's draft).
//   - The only thing we cache is /_next/static/, which Next content-hashes —
//     stale-forever is correct for those URLs.
//   - The cache name is versioned. activate sweeps every other cache, so a
//     bad cache can never permanently pin a client; bumping CACHE_VERSION
//     invalidates everything on next visit.
//   - A 'message' handler accepts { type: 'unregister' } so the client can
//     pull the kill switch from devtools or in code.

const CACHE_VERSION = "aired-static-v1";

self.addEventListener("install", () => {
  // No precache — there's nothing static we know up front, and the next
  // navigation will lazily populate the cache via the fetch handler.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)),
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

  // Never touch non-GETs — POST/PUT/DELETE flows (sign in, upload, ledger
  // writes) must always hit the network unmediated.
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Cross-origin requests (Supabase, R2 CDN, Google Fonts, anything else)
  // bypass the SW entirely — they're handled by the browser's own cache.
  if (url.origin !== self.location.origin) return;

  // Never cache the SW file itself or the manifest — both must stay live so
  // a deploy can change them.
  if (url.pathname === "/sw.js" || url.pathname === "/manifest.webmanifest") return;

  // Never cache anything touching auth — sign-in/out callbacks, OAuth
  // round-trips, Supabase server actions over /auth.
  if (url.pathname.startsWith("/auth/")) return;

  // Only the immutable Next build assets get cache-first. These are content-
  // hashed (/_next/static/<hash>/...) so the cached copy is safe forever and
  // the activate sweep clears them on a SW version bump.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Everything else (HTML navigations, /api/*, /icons/*, image responses)
  // falls through to the browser's normal network path.
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
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
