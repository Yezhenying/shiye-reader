const CACHE_PREFIX = 'shiyue-shell-';
let activeCache = `${CACHE_PREFIX}fallback`;

function baseUrl() {
  return new URL(self.registration.scope);
}

function appUrl(relativePath = '') {
  return new URL(relativePath.replace(/^\//, ''), baseUrl()).toString();
}

async function resolveActiveCache() {
  if (!activeCache.endsWith('fallback')) return activeCache;
  const keys = await caches.keys();
  activeCache = keys.filter(key => key.startsWith(CACHE_PREFIX)).sort().at(-1) || activeCache;
  return activeCache;
}

async function getManifest() {
  const cache = await caches.open(await resolveActiveCache());
  return cache.match(appUrl('sw-assets.json'))
    || fetch(appUrl('sw-assets.json'), { cache: 'no-store' }).catch(() => null);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch(appUrl('sw-assets.json'), { cache: 'no-store' });
    if (!response.ok) throw new Error('离线资源清单不可用');
    const manifest = await response.clone().json();
    activeCache = `${CACHE_PREFIX}${manifest.version}`;
    const cache = await caches.open(activeCache);
    await cache.put(appUrl('sw-assets.json'), response);
    await cache.addAll(manifest.assets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const shellKeys = keys.filter(key => key.startsWith(CACHE_PREFIX));
    activeCache = shellKeys.sort().at(-1) || activeCache;
    await Promise.all(shellKeys.filter(key => key !== activeCache).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CACHE_STATUS') return;
  event.waitUntil((async () => {
    const cache = await caches.open(await resolveActiveCache());
    const manifestResponse = await getManifest();
    let cached = false;
    let version = '';
    if (manifestResponse?.ok) {
      const manifest = await manifestResponse.json();
      version = manifest.version;
      const matches = await Promise.all(manifest.assets.map(asset => cache.match(asset)));
      cached = matches.every(Boolean) && activeCache === `${CACHE_PREFIX}${version}`;
    }
    event.ports?.[0]?.postMessage({ type: 'CACHE_STATUS', cached, version });
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    // A navigation must prefer the network when available so a deployed HTML file
    // can point at its newly hashed assets instead of being pinned by an old shell.
    if (event.request.mode === 'navigate') {
      try { return await fetch(event.request); }
      catch { return caches.match(appUrl('index.html')); }
    }
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && ['script', 'style', 'font', 'image', 'worker'].includes(event.request.destination)) {
        const cache = await caches.open(await resolveActiveCache());
        cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      throw error;
    }
  })());
});
