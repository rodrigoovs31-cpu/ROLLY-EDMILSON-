// Utilidades compartidas: carga de librerías, lectura de PDF, descargas y helpers.
import { SITE } from './config.js';

const ROOT = new URL('../../', import.meta.url);
export const asset = (path) => new URL(path, ROOT).href;

/* ---------- Carga perezosa de librerías ----------
   Las librerías pesadas (el 95% del peso de la web) se descargan desde jsDelivr,
   una CDN gratuita para código abierto, así casi no gastan el ancho de banda de tu hosting.
   Si jsDelivr no responde, se usa la copia local de la carpeta vendor/. */

const CDN = 'https://cdn.jsdelivr.net/npm/';
const LIBS = {
  pdfLib: {
    cdn: `${CDN}pdf-lib@1.17.1/dist/pdf-lib.esm.min.js`,
    local: 'vendor/pdf-lib.esm.min.js',
  },
  pdfjs: {
    cdn: {
      lib: `${CDN}pdfjs-dist@4.10.38/legacy/build/pdf.min.mjs`,
      worker: `${CDN}pdfjs-dist@4.10.38/legacy/build/pdf.worker.min.mjs`,
      fonts: `${CDN}pdfjs-dist@4.10.38/standard_fonts/`,
      cmaps: `${CDN}pdfjs-dist@4.10.38/cmaps/`,
    },
    local: {
      lib: 'vendor/pdfjs/pdf.min.mjs',
      worker: 'vendor/pdfjs/pdf.worker.min.mjs',
      fonts: 'vendor/pdfjs/standard_fonts/',
      cmaps: 'vendor/pdfjs/cmaps/',
    },
  },
  jszip: {
    cdn: `${CDN}jszip@3.10.1/dist/jszip.min.js`,
    local: 'vendor/jszip.min.js',
    integrity: 'sha384-+mbV2IY1Zk/X1p/nWllGySJSUN8uMs+gUAN10Or95UBH0fpj6GfKgPmgC5EXieXG',
  },
  sortable: {
    cdn: `${CDN}sortablejs@1.15.6/Sortable.min.js`,
    local: 'vendor/Sortable.min.js',
    integrity: 'sha384-HZZ/fukV+9G8gwTNjN7zQDG0Sp7MsZy5DDN6VfY3Be7V9dvQpEpR2jF2HlyFUUjU',
  },
  qpdf: {
    cdn: { js: `${CDN}@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.js`, wasm: `${CDN}@neslinesli93/qpdf-wasm@0.3.0/dist/qpdf.wasm` },
    local: { js: 'vendor/qpdf/qpdf.js', wasm: 'vendor/qpdf/qpdf.wasm' },
    integrity: 'sha384-viHHfnvZlwDzjAQCrTUX3UR1zDr3OW9ItyLOqwH2wTHYHXWK8NdKi5LFp++BT8NL',
  },
  // Librerías de scripts clásicos (definen una variable global). Se cargan con loadLib(nombre).
  html2canvas: {
    cdn: `${CDN}html2canvas@1.4.1/dist/html2canvas.min.js`, local: 'vendor/html2canvas.min.js', global: 'html2canvas',
    integrity: 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H',
  },
  docxPreview: {
    cdn: `${CDN}docx-preview@0.3.6/dist/docx-preview.min.js`, local: 'vendor/docx-preview.min.js', global: 'docx', needs: ['jszip'],
    integrity: 'sha384-kKPxR3hMxt6X0EM6PYDjS3F8X1XaTZE4HfBd4Fv6CRcS+KuEy/P0itqZAIkg7JCR',
  },
  docx: {
    cdn: `${CDN}docx@9.5.1/dist/index.iife.js`, local: 'vendor/docx.iife.js', global: 'docx',
    integrity: 'sha384-HWC8sFPgg/WYrr43jIR6e0YIKgPkS3VLdteGgh9MFlUet3xdAVEM8YS69xP4Puse',
  },
  pptxPreview: {
    cdn: `${CDN}pptx-preview@1.0.7/dist/pptx-preview.umd.js`, local: 'vendor/pptx-preview.umd.js', global: 'pptxPreview',
    integrity: 'sha384-CwntHHT2FbwZXuCmbf6K93YaEB9xRVVLaqFJ7pdMykeQABb/3MA0sbt2lGbgi1Mr',
  },
  pptxgen: {
    cdn: `${CDN}pptxgenjs@3.12.0/dist/pptxgen.bundle.js`, local: 'vendor/pptxgen.bundle.js', global: 'PptxGenJS',
    integrity: 'sha384-Cck14aA9cifjYolcnjebXRfWGkz5ltHMBiG4px/j8GS+xQcb7OhNQWZYyWjQ+UwQ',
  },
  xlsx: {
    cdn: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', local: 'vendor/xlsx.full.min.js', global: 'XLSX',
    integrity: 'sha384-EnyY0/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP+39Ckmn92stwABZynq1JyzdT',
  },
  jspdf: {
    cdn: `${CDN}jspdf@2.5.2/dist/jspdf.umd.min.js`, local: 'vendor/jspdf.umd.min.js', global: 'jspdf',
    integrity: 'sha384-en/ztfPSRkGfME4KIm05joYXynqzUgbsG5nMrj/xEFAHXkeZfO3yMK8QQ+mP7p1/',
  },
  forge: {
    cdn: `${CDN}node-forge@1.3.1/dist/forge.min.js`, local: 'vendor/forge.min.js', global: 'forge',
    integrity: 'sha384-xE6n3RBMZWgwAhyzoIMfY7HN3oDBa/+HBwFFNyxsdY8kseup7C4Blx1yDzprEESV',
  },
  autotable: {
    cdn: `${CDN}jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js`, local: 'vendor/jspdf.plugin.autotable.min.js', needs: ['jspdf'],
    check: () => window.jspdf?.jsPDF?.API?.autoTable,
    integrity: 'sha384-Xl/CUCfJbzsngMp0CFxkmF0VW/8C160IsGujqeQlIhaGxKz2+JsIGORFqtCPeldF',
  },
};

// Todas las direcciones de las librerías (para guardarlas y usar Maus sin internet).
export function libraryUrls() {
  const urls = [];
  for (const lib of Object.values(LIBS)) {
    const src = SITE.useCdn !== false ? lib.cdn : lib.local;
    const add = (u) => urls.push(SITE.useCdn !== false ? u : asset(u));
    if (typeof src === 'string') add(src);
    else for (const [k, v] of Object.entries(src)) if (!['fonts', 'cmaps'].includes(k)) add(v);
  }
  return urls;
}

// Intenta primero la CDN y, si falla, la copia local.
async function cdnOrLocal(load) {
  if (SITE.useCdn !== false) {
    try {
      return await load('cdn');
    } catch (err) {
      console.warn('CDN no disponible; usando la copia local.', err);
    }
  }
  return load('local');
}

const scriptCache = new Map();
export function loadScript(src, integrity) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      if (integrity) {
        s.integrity = integrity;
        s.crossOrigin = 'anonymous';
      }
      s.onload = resolve;
      s.onerror = () => {
        scriptCache.delete(src);
        s.remove();
        reject(new Error('No se pudo cargar un componente. Revisa tu conexión e inténtalo otra vez.'));
      };
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(src);
}

const loadUmd = (lib, globalName) => cdnOrLocal(async (where) => {
  await loadScript(where === 'cdn' ? lib.cdn : asset(lib.local), where === 'cdn' ? lib.integrity : null);
  if (!window[globalName]) throw new Error(`${globalName} no se cargó`);
  return window[globalName];
});

const libCache = new Map();
// Carga una librería de LIBS (y sus dependencias) y devuelve su variable global.
export function loadLib(key) {
  if (!libCache.has(key)) {
    const lib = LIBS[key];
    libCache.set(key, (async () => {
      for (const dep of lib.needs || []) await loadLib(dep);
      return cdnOrLocal(async (where) => {
        await loadScript(where === 'cdn' ? lib.cdn : asset(lib.local), where === 'cdn' ? lib.integrity : null);
        const value = lib.check ? lib.check() : window[lib.global];
        if (!value) throw new Error(`${key} no se cargó`);
        return value;
      });
    })().catch((err) => {
      libCache.delete(key);
      throw new Error('No se pudo cargar un componente. Revisa tu conexión e inténtalo otra vez.', { cause: err });
    }));
  }
  return libCache.get(key);
}

let pdfLibPromise;
export function getPdfLib() {
  pdfLibPromise ??= cdnOrLocal((where) => import(where === 'cdn' ? LIBS.pdfLib.cdn : asset(LIBS.pdfLib.local)));
  return pdfLibPromise;
}

let pdfjsPromise;
export function getPdfjs() {
  pdfjsPromise ??= cdnOrLocal(async (where) => {
    const p = where === 'cdn' ? LIBS.pdfjs.cdn : Object.fromEntries(Object.entries(LIBS.pdfjs.local).map(([k, v]) => [k, asset(v)]));
    const lib = await import(p.lib);
    lib.GlobalWorkerOptions.workerSrc = p.worker;
    return { lib, fonts: p.fonts, cmaps: p.cmaps };
  });
  return pdfjsPromise;
}

LIBS.jszip.global = 'JSZip';
export const getJSZip = () => loadLib('jszip');

let sortablePromise;
export function getSortable() {
  sortablePromise ??= loadUmd(LIBS.sortable, 'Sortable');
  return sortablePromise;
}

let qpdfPromise;
function getQpdf() {
  qpdfPromise ??= cdnOrLocal(async (where) => {
    const p = where === 'cdn' ? LIBS.qpdf.cdn : { js: asset(LIBS.qpdf.local.js), wasm: asset(LIBS.qpdf.local.wasm) };
    await loadScript(p.js, where === 'cdn' ? LIBS.qpdf.integrity : null);
    if (typeof window.Module !== 'function') throw new Error('qpdf no se cargó');
    // Si el .wasm de la CDN fallara, se intenta con el local.
    return { factory: window.Module, wasm: [...new Set([p.wasm, asset(LIBS.qpdf.local.wasm)])] };
  });
  return qpdfPromise;
}

export async function runQpdf(args, inputs) {
  const { factory, wasm } = await getQpdf();
  // qpdf escribe sus mensajes con console.log/console.error, que enlaza al crearse:
  // los redirigimos durante la creación para poder leer sus errores.
  const errors = [];
  const { log, error } = console;
  let qpdf;
  for (const url of wasm) {
    console.log = () => {};
    console.error = (...parts) => errors.push(parts.join(' '));
    try {
      qpdf = await factory({ locateFile: () => url, noInitialRun: true });
      break;
    } catch (err) {
      if (url === wasm[wasm.length - 1]) throw new Error('No se pudo cargar un componente. Revisa tu conexión e inténtalo otra vez.');
    } finally {
      console.log = log;
      console.error = error;
    }
  }
  for (const [name, bytes] of Object.entries(inputs)) qpdf.FS.writeFile(name, bytes);
  let code;
  try {
    code = qpdf.callMain(args);
  } catch (e) {
    code = typeof e?.status === 'number' ? e.status : 2;
  }
  const read = (name) => {
    try { return qpdf.FS.readFile(name); } catch { return null; }
  };
  return { code, errors, read };
}

/* ---------- Archivos ---------- */

export const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
export const isImage = (file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(file.name);

export async function readBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

export const baseName = (name) => name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_') || 'documento';

export const yieldUI = () => new Promise((r) => setTimeout(r, 0));

export class UserError extends Error {}

/* ---------- PDF ---------- */

// Abre un PDF con pdf-lib. Si solo tiene restricciones (sin contraseña de apertura),
// las quita automáticamente con qpdf para poder editarlo.
export async function loadPdfDoc(bytes) {
  const { PDFDocument } = await getPdfLib();
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (!/encrypted/i.test(err.message)) {
      throw new UserError('No pudimos leer este PDF. Puede estar dañado o no ser un PDF real.');
    }
    const { code, read } = await runQpdf(['--decrypt', '/in.pdf', '/out.pdf'], { '/in.pdf': bytes });
    const out = read('/out.pdf');
    if (code === 2 || !out) {
      throw new UserError('Este PDF tiene contraseña. Quítasela primero con "Desbloquear PDF".');
    }
    return PDFDocument.load(out, { updateMetadata: false });
  }
}

export async function openPdfjs(bytes, password) {
  const { lib, fonts, cmaps } = await getPdfjs();
  const task = lib.getDocument({
    data: bytes.slice(),
    password,
    standardFontDataUrl: fonts,
    cMapUrl: cmaps,
    cMapPacked: true,
    isEvalSupported: false,
  });
  try {
    return await task.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      throw new UserError('Este PDF tiene contraseña. Quítasela primero con "Desbloquear PDF".');
    }
    throw new UserError('No pudimos leer este PDF. Puede estar dañado o no ser un PDF real.');
  }
}

const MAX_CANVAS_PIXELS = 16_000_000;

// Dibuja una página de pdf.js en un canvas con fondo blanco.
export async function renderPage(page, scale) {
  let viewport = page.getViewport({ scale });
  const pixels = viewport.width * viewport.height;
  if (pixels > MAX_CANVAS_PIXELS) {
    viewport = page.getViewport({ scale: scale * Math.sqrt(MAX_CANVAS_PIXELS / pixels) });
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function renderThumb(page, width = 220) {
  const base = page.getViewport({ scale: 1 });
  const scale = (width * Math.min(window.devicePixelRatio || 1, 2)) / base.width;
  return renderPage(page, scale);
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen.'))), type, quality);
  });
}

export function freeCanvas(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

// Interpreta rangos tipo "1-3, 5, 8-" → [[1,3],[5,5],[8,max]]
export function parseRanges(text, max) {
  const parts = String(text).split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) throw new UserError('Escribe al menos una página o rango, por ejemplo: 1-3, 5');
  return parts.map((part) => {
    const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$|^(\d+)$/);
    if (!m) throw new UserError(`"${part}" no es un rango válido. Usa números como 1-3 o 5.`);
    let a, b;
    if (m[3]) a = b = Number(m[3]);
    else { a = m[1] ? Number(m[1]) : 1; b = m[2] ? Number(m[2]) : max; }
    if (a < 1 || b < 1) throw new UserError('Las páginas empiezan en 1.');
    if (a > max || b > max) throw new UserError(`El PDF solo tiene ${max} páginas.`);
    if (a > b) [a, b] = [b, a];
    return [a, b];
  });
}

export function rangesToSet(ranges) {
  const set = new Set();
  for (const [a, b] of ranges) for (let i = a; i <= b; i++) set.add(i);
  return set;
}

export function setToRanges(set) {
  const nums = [...set].sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    const start = nums[i];
    while (nums[i + 1] === nums[i] + 1) i++;
    out.push(start === nums[i] ? `${start}` : `${start}-${nums[i]}`);
  }
  return out.join(', ');
}

/* ---------- Geometría: dibujar "derecho" sobre páginas giradas ---------- */

// Tamaño visible de la página (como se ve en pantalla, con su giro aplicado).
export function visualBox(page) {
  const box = page.getCropBox();
  const rot = ((page.getRotation().angle % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  return { box, rot, width: swap ? box.height : box.width, height: swap ? box.width : box.height };
}

// Convierte un punto visible (origen abajo-izquierda) a coordenadas reales del PDF.
export function visualToPdf(vb, vx, vy) {
  const { box, rot } = vb;
  const W = box.width, H = box.height;
  let x, y;
  if (rot === 90) { x = W - vy; y = vx; }
  else if (rot === 180) { x = W - vx; y = H - vy; }
  else if (rot === 270) { x = vy; y = H - vx; }
  else { x = vx; y = vy; }
  return { x: box.x + x, y: box.y + y };
}

/* ---------- Descargas ---------- */

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function zipBlobs(files) {
  const JSZip = await getJSZip();
  const zip = new JSZip();
  const used = new Set();
  for (const f of files) {
    let name = f.name;
    let n = 2;
    while (used.has(name)) name = f.name.replace(/(\.[^.]+)?$/, ` (${n++})$1`);
    used.add(name);
    zip.file(name, f.blob);
  }
  return zip.generateAsync({ type: 'blob' });
}

export const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

// Texto seguro para las fuentes estándar de PDF (WinAnsi: español sí, emojis no).
export function winAnsiSafe(font, text) {
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { out += ''; }
  }
  return out;
}
