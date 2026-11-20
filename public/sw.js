/**
 * Ping by DOT — Privacy-Hardened Production Service Worker
 *
 * Security & Privacy Invariants:
 * 1. NEVER caches private messages, Supabase REST/Auth/Realtime/Signed-Storage responses,
 *    server functions, `/admin`, `/messages`, `/api/`, non-GET requests, or any request
 *    carrying an Authorization header.
 * 2. Caches ONLY immutable static assets, brand icons, manifest, and the `/offline.html`
 *    fallback page.
 * 3. Supports controlled updates (`SKIP_WAITING`) and full cache wipe on logout
 *    (`CLEAR_ALL_CACHES`).
 */

const CACHE_VERSION = "ping-static-v1";
const STATIC_PRECACHE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon-180.png",
  "/brand/ping-icon.svg",
];

const NEVER_CACHE_PATH_PREFIXES = [
  "/rest/v1/",
  "/auth/v1/",
  "/realtime/",
  "/storage/v1/object/sign/",
  "/storage/v1/object/authenticated/",
  "/api/",
  "/_server",
  "/admin",
  "/messages",
  "/settings",
  "/wallet",
  "/oauth/",
  "/spotlight/editorial",
];

function isNeverCacheRequest(request, url) {
  if (request.method !== "GET") return true;
  if (request.headers.has("Authorization") || request.headers.has("apikey")) return true;
  if (url.origin !== self.location.origin) return true;
  for (const prefix of NEVER_CACHE_PATH_PREFIXES) {
    if (url.pathname.startsWith(prefix)) return true;
  }
  return false;
}

function isCacheableStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/offline.html"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(STATIC_PRECACHE))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((stale) => caches.delete(stale))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const type = event?.data?.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (type === "CLEAR_ALL_CACHES") {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {}),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept or cache private, authenticated, API, or cross-origin traffic
  if (isNeverCacheRequest(request, url)) {
    return;
  }

  // Navigation requests: network-first with graceful offline.html fallback (never cache HTML of user routes)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const fallback = await caches.match("/offline.html");
        return (
          fallback ||
          new Response("You are currently offline. Please reconnect to continue using Ping.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
    return;
  }

  // Immutable static assets: stale-while-revalidate
  if (isCacheableStaticAsset(url)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") {
              cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => undefined);
        return cached || (await networkPromise) || Response.error();
      }),
    );
  }
});
