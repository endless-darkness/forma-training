/* Static assets only: workout data never enters this cache. */
const BUILD_VERSION = '__FORMA_CACHE_VERSION__';
const VERSION = BUILD_VERSION.startsWith('__') ? 'dev-v1' : BUILD_VERSION;
const SCOPE = self.registration.scope;
const CACHE_PREFIX = `forma-training:${SCOPE}:`;
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/data.js',
  './js/engine.js',
  './js/storage.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
].map(path => new URL(path, SCOPE).href);
const SHELL_URLS = new Set(SHELL);
const INDEX_URL = new URL('./index.html', SCOPE).href;

self.addEventListener('install', event => {
  // addAll is atomic: an incomplete new version cannot replace a working one.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))
  ));
  // The app asks the user before activating an update, protecting active sessions.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const scope = new URL(SCOPE);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;

  // Ignore query strings only for known shell files. Never cache arbitrary URLs.
  url.search = '';
  url.hash = '';
  const isNavigation = request.mode === 'navigate';
  if (!isNavigation && !SHELL_URLS.has(url.href)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Keep HTML and JavaScript on the same version until the waiting SW activates.
    const cached = await cache.match(isNavigation ? INDEX_URL : url.href);
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch {
      return new Response('Forma is not available offline yet. Reconnect and open it once.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
