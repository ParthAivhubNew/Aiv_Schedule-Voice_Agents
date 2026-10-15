// Service worker: makes the app installable and keeps the app shell available offline.
// It never touches API, media or websocket traffic, so calls and data are always live.
const CACHE = "outreach-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];
const LIVE = /^\/(api|v1|media|ws|docs|redoc|openapi\.json|health|admin|privacy|terms|data-deletion)/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || LIVE.test(url.pathname)) return;

  // Pages: network first so a new release shows at once; the cached shell is the offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }

  // Built assets have hashed names, so cache-first is safe.
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && url.pathname.startsWith("/assets/")) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
