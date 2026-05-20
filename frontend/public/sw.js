// Tanva Image Cache Service Worker
// Caches CDN/OSS images persistently across page reloads.

const CACHE_NAME = 'tanva-img-v1';
const MAX_ENTRIES = 500;
const META_KEY = '__meta__';

// URL patterns for images to cache
const IMAGE_HOSTS = [
  /\.aliyuncs\.com(\/|$)/,
  /\.tos[^.]*\.volces\.com(\/|$)/,
  /\.volccdn\.com(\/|$)/,
];

const IMAGE_PATHS = [
  /^\/api\/assets\/proxy/,
];

function shouldCache(request) {
  if (request.method !== 'GET') return false;
  if (request.headers.get('cache-control') === 'no-cache') return false;

  const url = new URL(request.url);

  // Check host-based patterns
  for (const pattern of IMAGE_HOSTS) {
    if (pattern.test(url.hostname)) return true;
  }

  // Check path-based patterns (same origin)
  if (url.origin === self.location.origin) {
    for (const pattern of IMAGE_PATHS) {
      if (pattern.test(url.pathname)) return true;
    }
  }

  return false;
}

// Read the ordered list of cached keys from the meta entry.
async function getMeta(cache) {
  const metaResp = await cache.match(META_KEY);
  if (!metaResp) return [];
  try {
    return await metaResp.json();
  } catch {
    return [];
  }
}

// Persist the ordered list of cached keys back to the meta entry.
async function saveMeta(cache, keys) {
  const body = JSON.stringify(keys);
  await cache.put(
    META_KEY,
    new Response(body, { headers: { 'Content-Type': 'application/json' } }),
  );
}

// Record a newly cached key and evict oldest entries when over limit.
async function trackEntry(cache, key) {
  let keys = await getMeta(cache);

  // Remove existing occurrence so we can re-append (LRU refresh)
  keys = keys.filter((k) => k !== key);
  keys.push(key);

  // Evict oldest entries beyond the limit
  while (keys.length > MAX_ENTRIES) {
    const evicted = keys.shift();
    await cache.delete(evicted);
  }

  await saveMeta(cache, keys);
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Delete all cache versions that are not the current one
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== META_KEY)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// ── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  if (!shouldCache(event.request)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);
      if (cached) return cached;

      // Network fallback
      let response;
      try {
        response = await fetch(event.request);
      } catch {
        return new Response('Network error', { status: 503 });
      }

      // Only cache valid image responses that are not opaque
      const type = response.headers.get('content-type') || '';
      if (
        response.status === 200 &&
        type.startsWith('image/') &&
        (response.type === 'cors' || response.type === 'basic')
      ) {
        const responseToCache = response.clone();
        await cache.put(event.request, responseToCache);
        await trackEntry(cache, event.request.url);
      }

      return response;
    })(),
  );
});
