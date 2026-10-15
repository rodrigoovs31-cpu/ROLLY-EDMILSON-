// Service worker de Maus: guarda la web y sus librerías para que funcione sin internet.
// Este archivo es una plantilla: scripts/build.mjs genera sw.js con la versión y la lista de archivos.
const VERSION = '__VERSION__';
const SHELL = __SHELL__;
const CACHE = `maus-shell-${VERSION}`;
const LIBS = 'maus-libs-v1';
const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdn.sheetjs.com', 'fonts.gstatic.com', 'fonts.googleapis.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('maus-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Primero internet (para tener siempre lo último) y, sin conexión, lo guardado.
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }))
      || (request.mode === 'navigate' ? cache.match('index.html') : Response.error());
  }
}

// Las librerías tienen versión fija: si ya están guardadas, se usan directo.
async function cacheFirst(request) {
  const cache = await caches.open(LIBS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (LIB_HOSTS.includes(url.hostname) || (url.origin === self.location.origin && url.pathname.includes('/vendor/'))) {
    event.respondWith(cacheFirst(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  }
});

// "Usar sin internet": descarga todas las librerías de una vez.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'precache') return;
  event.waitUntil((async () => {
    const cache = await caches.open(LIBS);
    const urls = event.data.urls || [];
    let done = 0;
    for (const url of urls) {
      try { if (!(await cache.match(url))) { const r = await fetch(url, { mode: 'cors' }); if (r.ok) await cache.put(url, r); } } catch { /* sigue con las demás */ }
      done++;
      event.source?.postMessage({ type: 'precache-progress', done, total: urls.length });
    }
    event.source?.postMessage({ type: 'precache-done', total: urls.length });
  })());
});
