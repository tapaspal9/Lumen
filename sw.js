/* ============================================================================
 * Lumen — Service Worker  (sw.js)
 *
 * Strategy:
 *   - App shell (same-origin HTML/CSS/JS): cache-first → instant offline launch
 *   - CDN scripts (Babel/React): network-first → fall back to cache
 *   - Photo processing stays 100% on the main thread — the SW never touches pixels
 *
 * Bump CACHE_NAME whenever the app shell changes to force clients to update.
 * ============================================================================ */

const CACHE_NAME = 'lumen-v1';

/* Files that must be available offline for the app to launch.
 * NOTE: paths reflect the CURRENT project structure (pre-Phase-0 refactor).
 * Update to js/engine/ and js/ui/ paths after the folder restructure. */
const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.json',
  /* core infrastructure */
  '/js/core/db.js',
  '/js/core/storage-provider.js',
  '/js/core/local-provider.js',
  '/js/core/store.js',
  /* imaging engine */
  '/js/imaging.js',
  '/js/analysis.js',
  '/js/presets.js',
  '/js/suggestions.js',
  '/js/exif.js',
  '/js/scene.js',
  '/js/histogram.js',
  /* ui modules */
  '/js/app.js',
  '/js/crop.js',
  '/js/export.js',
  '/js/panels.js',
  '/js/dashboard.js',
  /* icons */
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* ── Install: pre-cache the app shell ───────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())   // activate immediately, don't wait for old tabs
  );
});

/* ── Activate: clean up stale caches ────────────────────────────────────── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())   // take control of all open pages
  );
});

/* ── Fetch: route requests ──────────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  const req = event.request;

  // Pass through non-GET requests (file exports use POST-style object URLs)
  if (req.method !== 'GET') return;

  const url  = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCDN        = url.hostname.includes('unpkg.com') ||
                       url.hostname.includes('cdnjs.cloudflare.com');

  if (isSameOrigin) {
    // Cache-first: serve from cache, update cache in background
    event.respondWith(cacheFirst(req));
  } else if (isCDN) {
    // Network-first for CDN: fresh when online, cached when offline
    event.respondWith(networkFirst(req));
  }
  // All other origins pass through unmodified
});

/* ── Cache-first ─────────────────────────────────────────────────────────── */
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;

  try {
    const response = await fetch(req);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, response.clone());   // cache for next time
    }
    return response;
  } catch {
    // Truly offline and not cached — return the shell as fallback
    return caches.match('/index.html');
  }
}

/* ── Network-first ───────────────────────────────────────────────────────── */
async function networkFirst(req) {
  try {
    const response = await fetch(req);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, response.clone());
    }
    return response;
  } catch {
    return caches.match(req);   // fall back to whatever we have cached
  }
}

/* ── Background sync: flush pending changes when connectivity returns ─────── */
self.addEventListener('sync', event => {
  if (event.tag === 'lumen-sync') {
    // Phase 4: cloud sync engine will flush the outbox here.
    // For now this is a no-op — the outbox pattern is already in the data layer.
    event.waitUntil(Promise.resolve());
  }
});

/* ── Push notifications (placeholder for Phase 4+) ─────────────────────── */
self.addEventListener('push', event => {
  // Reserved for future sync notifications (e.g. "Sync complete on your laptop")
});
