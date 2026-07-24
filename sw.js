/* オフラインキャッシュ（アプリシェルのキャッシュファースト） */
const VERSION = "train800-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./bundle.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          const copy = res.clone();
          if (res.ok && new URL(e.request.url).origin === location.origin) {
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});
