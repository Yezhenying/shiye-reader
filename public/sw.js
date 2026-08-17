const CACHE_PREFIX = 'shiyue-shell-';
let activeCache = `${CACHE_PREFIX}fallback`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/sw-assets.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('离线资源清单不可用');
    const manifest = await response.clone().json();
    activeCache = `${CACHE_PREFIX}${manifest.version}`;
    const cache = await caches.open(activeCache);
    await cache.put('/sw-assets.json', response);
    await cache.addAll(manifest.assets);
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
    if (activeCache.endsWith('fallback')) activeCache = (await caches.keys()).find(key => key.startsWith(CACHE_PREFIX)) || activeCache;
    const cache = await caches.open(activeCache);
    const manifestResponse = await cache.match('/sw-assets.json') || await fetch('/sw-assets.json', { cache: 'no-store' }).catch(() => null);
    let cached = false, version = '';
    if (manifestResponse?.ok) {
      const manifest = await manifestResponse.json(); version = manifest.version;
      const matches = await Promise.all(manifest.assets.map(asset => cache.match(asset)));
      cached = matches.every(Boolean) && activeCache === `${CACHE_PREFIX}${version}`;
    }
    event.ports?.[0]?.postMessage({ type: 'CACHE_STATUS', cached, version });
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    if (activeCache.endsWith('fallback')) activeCache = (await caches.keys()).find(key => key.startsWith(CACHE_PREFIX)) || activeCache;
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok && ['script', 'style', 'font', 'image', 'worker'].includes(event.request.destination)) {
        const cache = await caches.open(activeCache); cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      if (event.request.mode === 'navigate') return caches.match('/index.html');
      throw error;
    }
  })());
});
