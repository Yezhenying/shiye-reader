const CACHE_PREFIX = 'shiyue-shell-';
let activeCache = `${CACHE_PREFIX}fallback`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/sw-assets.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('离线资源清单不可用');
    const manifest = await response.json();
    activeCache = `${CACHE_PREFIX}${manifest.version}`;
    const cache = await caches.open(activeCache);
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

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== location.origin) return;
  event.respondWith((async () => {
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
