/* sw.js — makes the app work with the wifi off.
 *
 * On first visit the browser saves a copy of every file below. After that the
 * app launches from that copy, instantly, with or without a connection. When
 * a connection is available it quietly re-fetches in the background, so a new
 * version is picked up the next time the app is opened.
 *
 * This only caches the app itself. Practice data never comes through here —
 * it lives in IndexedDB on the device.
 */

const VERSION = 'v1';
const CACHE = `load-tracker-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/models.js',
  './js/load.js',
  './js/ui.js',
  './js/components.js',
  './js/views/practice.js',
  './js/views/drills.js',
  './js/views/roster.js',
  './js/views/analysis.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll fails the whole install if any single file 404s, so add
      // individually and tolerate misses.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match('./index.html'));

      // Stale-while-revalidate: instant from cache, refresh underneath.
      return cached || network;
    })
  );
});
