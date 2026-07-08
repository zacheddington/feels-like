// sw.js — the service worker. Classic script (not a module).
//
// Strategy:
//  - App shell (same-origin): network-first, cached copy as fallback. Online
//    users always get the freshly deployed code; offline users get the last
//    version they saw.
//  - Weather/geocoding APIs: network-first with cache fallback, so reopening
//    the app offline shows the last data instead of an error.
//  - Fonts (Google Fonts CDN): cache-first — they never change and are the
//    slowest thing on a cold load.
//
// BUMP VERSION ON EVERY RELEASE (see CLAUDE.md "Releasing"): it retires the
// old cache on activate.

const VERSION = 'v1.5.0';
const CACHE = `feelslike-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './changelog.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/ui.js',
  './js/api.js',
  './js/feelslike.js',
  './js/theme.js',
  './js/explain.js',
  './js/mock.js',
  './js/storage.js',
  './js/changelog.js',
  './js/feedback.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-mono.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok || fresh.type === 'opaque') cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (hit) {
      // Flag the fallback so the app can label the data as offline/stale
      const headers = new Headers(hit.headers);
      headers.set('X-Feels-Like-Cache', 'fallback');
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    }
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok || fresh.type === 'opaque') cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req));
  } else {
    // Same-origin shell and the weather/geocoding APIs both want
    // fresh-when-online, last-known-good when offline.
    event.respondWith(networkFirst(req));
  }
});
