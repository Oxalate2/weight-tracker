// Service worker: saves the app's files on first visit, then serves them without internet.
// To ship an update, change CACHE (e.g. v2) so devices fetch the new files.
const CACHE = "weight-tracker-v3";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "db.js", "analytics.js", "nutrition.js", "backup.js",
  "chart-view.js", "nutrition-view.js", "vendor/chart.umd.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)));
});
