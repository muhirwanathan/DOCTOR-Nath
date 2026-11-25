// Service worker: makes the app shell load with no connection (SRS 2.4, NFR1).
// Pages and assets: network first, falling back to cache. API calls are never
// cached here; the app's IndexedDB outbox handles offline writes with idempotency keys.
const CACHE = "dr-nath-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Client-side routes all resolve to the app shell.
  const isNavigation = req.mode === "navigate";
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(isNavigation ? "/index.html" : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(isNavigation ? "/index.html" : req).then((hit) => hit || Response.error())),
  );
});
