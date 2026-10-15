// Utilidades compartidas: carga de librerías, lectura de PDF, descargas y helpers.

const ROOT = new URL('../../', import.meta.url);
export const asset = (path) => new URL(path, ROOT).href;

/* ---------- Carga perezosa de librerías ---------- */

const scriptCache = new Map();
export function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => {
        scriptCache.delete(src);
        reject(new Error('No se pudo cargar un componente. Revisa tu conexión e inténtalo otra vez.'));
      };
      document.head.appendChild(s);
    }));
  }
  return scriptCache.get(src);
}

let pdfLibPromise;
export function getPdfLib() {
  pdfLibPromise ??= import(asset('vendor/pdf-lib.esm.min.js'));
  return pdfLibPromise;
}

let pdfjsPromise;
export function getPdfjs() {
  pdfjsPromise ??= import(asset('vendor/pdfjs/pdf.min.mjs')).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = asset('vendor/pdfjs/pdf.worker.min.mjs');
    return lib;
  });
  return pdfjsPromise;
}

export async function getJSZip() {
  await loadScript(asset('vendor/jszip.min.js'));
  return window.JSZip;
}

export async function getSortable() {
  await loadScript(asset('vendor/Sortable.min.js'));
  return window.Sortable;
}

let qpdfFactory;
export async function runQpdf(args, inputs) {
  if (!qpdfFactory) {
    await loadScript(asset('vendor/qpdf/qpdf.js'));
    qpdfFactory = window.Module;
  }
  // qpdf escribe sus mensajes con console.log/console.error, que enlaza al crearse:
  // los redirigimos durante la creación para poder leer sus errores.
  const errors = [];
  const { log, error } = console;
  console.log = () => {};
  console.error = (...parts) => errors.push(parts.join(' '));
  let qpdf;
  try {
    qpdf = await qpdfFactory({ locateFile: () => asset('vendor/qpdf/qpdf.wasm'), noInitialRun: true });
  } finally {
    console.log = log;
    console.error = error;
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
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password,
    standardFontDataUrl: asset('vendor/pdfjs/standard_fonts/'),
    cMapUrl: asset('vendor/pdfjs/cmaps/'),
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
