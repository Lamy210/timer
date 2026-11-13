const CACHE = "mtg-timer-v8";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./js/time.js",
  "./js/alerts.js",
  "./js/storage.js",
  "./js/ui.js",
  "./js/result.js",
  "./js/history.js",
  "./js/setup.js",
  "./js/run-view.js",
  "./js/run-state.js",
  "./js/run.js",
  "./js/run-alarms.js",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put("./index.html", response.clone());
        }
        return response;
      } catch (e) {
        const cached = await caches.match("./index.html");
        if (cached) return cached;
        return new Response("オフラインです", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    } catch (e) {
      const cached = await cache.match(event.request);
      return cached || new Response("", { status: 503 });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  const action = event.action;
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    if (action === "extend5" || action === "finish") {
      for (const client of windows) {
        client.postMessage({ type: "notification-action", action: action });
      }
    }
    for (const client of windows) {
      if ("focus" in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow("./");
  })());
});
