// Service worker de Maus: guarda la web y sus librerías para que funcione sin internet.
// Este archivo es una plantilla: scripts/build.mjs genera sw.js con la versión y la lista de archivos.
const VERSION = 'mv9mqwdb';
const SHELL = [
  "index.html",
  "flujos.html",
  "unir-pdf.html",
  "dividir-pdf.html",
  "comprimir-pdf.html",
  "jpg-a-pdf.html",
  "pdf-a-jpg.html",
  "firmar-pdf.html",
  "resumir-pdf.html",
  "organizar-pdf.html",
  "rotar-pdf.html",
  "eliminar-paginas.html",
  "extraer-paginas.html",
  "numerar-paginas.html",
  "marca-de-agua.html",
  "proteger-pdf.html",
  "desbloquear-pdf.html",
  "ocr-pdf.html",
  "escanear-pdf.html",
  "reparar-pdf.html",
  "word-a-pdf.html",
  "powerpoint-a-pdf.html",
  "excel-a-pdf.html",
  "html-a-pdf.html",
  "pdf-a-word.html",
  "pdf-a-powerpoint.html",
  "pdf-a-excel.html",
  "pdf-a-pdfa.html",
  "recortar-pdf.html",
  "editar-pdf.html",
  "formularios-pdf.html",
  "firma-digital.html",
  "censurar-pdf.html",
  "comparar-pdf.html",
  "traducir-pdf.html",
  "pdf-a-markdown.html",
  "privacidad.html",
  "terminos.html",
  "assets/css/maus.css?v=mv9mqwdb",
  "assets/js/site.js?v=mv9mqwdb",
  "assets/js/tool-page.js?v=mv9mqwdb",
  "assets/js/admin.js",
  "assets/js/config.js",
  "assets/js/docx-build.js",
  "assets/js/env.js",
  "assets/js/handoff.js",
  "assets/js/icons.js",
  "assets/js/lib.js",
  "assets/js/pades.js",
  "assets/js/page-editor.js",
  "assets/js/pages-view.js",
  "assets/js/pdf-engine.js",
  "assets/js/pro.js",
  "assets/js/render-html.js",
  "assets/js/site.js",
  "assets/js/text-layout.js",
  "assets/js/tool-page.js",
  "assets/js/tools-data.js",
  "assets/js/ui.js",
  "assets/js/tools/_password.js",
  "assets/js/tools/_select.js",
  "assets/js/tools/compare.js",
  "assets/js/tools/compress.js",
  "assets/js/tools/crop.js",
  "assets/js/tools/digital-sign.js",
  "assets/js/tools/edit.js",
  "assets/js/tools/excel-to-pdf.js",
  "assets/js/tools/extract-pages.js",
  "assets/js/tools/forms.js",
  "assets/js/tools/html-to-pdf.js",
  "assets/js/tools/images-to-pdf.js",
  "assets/js/tools/merge.js",
  "assets/js/tools/ocr.js",
  "assets/js/tools/organize.js",
  "assets/js/tools/page-numbers.js",
  "assets/js/tools/pdf-to-excel.js",
  "assets/js/tools/pdf-to-images.js",
  "assets/js/tools/pdf-to-markdown.js",
  "assets/js/tools/pdf-to-pdfa.js",
  "assets/js/tools/pdf-to-pptx.js",
  "assets/js/tools/pdf-to-word.js",
  "assets/js/tools/pptx-to-pdf.js",
  "assets/js/tools/protect.js",
  "assets/js/tools/redact.js",
  "assets/js/tools/remove-pages.js",
  "assets/js/tools/repair.js",
  "assets/js/tools/rotate.js",
  "assets/js/tools/scan.js",
  "assets/js/tools/sign.js",
  "assets/js/tools/split.js",
  "assets/js/tools/summarize.js",
  "assets/js/tools/translate.js",
  "assets/js/tools/unlock.js",
  "assets/js/tools/watermark.js",
  "assets/js/tools/word-to-pdf.js",
  "assets/workers/pdf-core.js",
  "assets/workers/pdfEngine.worker.js",
  "assets/img/favicon.svg",
  "assets/img/icon-192.png",
  "manifest.webmanifest"
];
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
