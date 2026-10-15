// Cliente del Web Worker del motor PDF (assets/workers/pdfEngine.worker.js).
// El trabajo pesado corre en otro hilo: la página no se congela y la barra de progreso
// avanza suave aunque el PDF tenga cientos de páginas. Los archivos se envían al worker
// como File (sin copiar sus bytes) y el resultado vuelve transferido (sin copias).
// Si el navegador no pudiera abrir el worker, se usa el mismo código en la página.
import { asset, engineLibs, getPdfLib, runQpdf, loadScript, pdfBlob, UserError } from './lib.js';

const MESSAGES = {
  password: 'Este PDF tiene contraseña. Quítasela primero con "Desbloquear PDF".',
  damaged: 'No pudimos leer este PDF. Puede estar dañado o no ser un PDF real.',
};

const OOM = /out of memory|allocation failed|memoria/i;
const TOO_BIG = 'Este documento es demasiado grande para la memoria de este dispositivo. Divídelo en partes o usa una computadora.';

class WorkerUnavailable extends Error {}

let worker = null;
let broken = typeof Worker === 'undefined';
let seq = 0;
const jobs = new Map();

function failAll(err) {
  for (const job of jobs.values()) job.reject(err);
  jobs.clear();
}

function getWorker() {
  if (worker || broken) return worker;
  try {
    worker = new Worker(asset('assets/workers/pdfEngine.worker.js'), { name: 'maus-pdf-engine' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = ({ data: m }) => {
    const job = jobs.get(m.id);
    if (!job) return;
    if (m.type === 'progress') {
      job.onProgress?.(m.value, m.label);
      return;
    }
    jobs.delete(m.id);
    if (m.type === 'done') job.resolve(m.result);
    else if (m.code === 'init') {
      broken = true;
      job.reject(new WorkerUnavailable(m.message));
    } else if (OOM.test(m.message)) job.reject(new UserError(TOO_BIG));
    else if (MESSAGES[m.code]) job.reject(new UserError(MESSAGES[m.code]));
    else if (m.code === 'range') job.reject(new UserError(m.message));
    else job.reject(new Error(m.message));
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    worker?.terminate();
    worker = null;
    if (OOM.test(event.message || '')) {
      // Sin memoria: reintentar en la página sería peor. Se avisa y el próximo trabajo abre un worker nuevo.
      failAll(new UserError(TOO_BIG));
      return;
    }
    // El script del worker no cargó: se pasa al plan B (procesar en la página).
    broken = true;
    failAll(new WorkerUnavailable(event.message || 'worker'));
  };
  worker.postMessage({ type: 'init', libs: engineLibs() });
  return worker;
}

function call(op, payload, onProgress) {
  const w = getWorker();
  if (!w) return Promise.reject(new WorkerUnavailable('sin worker'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, op, payload });
  });
}

// Plan B: el mismo núcleo, en la página.
let corePromise;
async function mainThread() {
  corePromise ??= loadScript(asset('assets/workers/pdf-core.js')).then(() => window.MausPdfCore);
  const [core, PDFLib] = await Promise.all([corePromise, getPdfLib()]);
  return { core, PDFLib, qpdf: runQpdf };
}

async function withFallback(viaWorker, viaPage) {
  try {
    return await viaWorker();
  } catch (err) {
    if (!(err instanceof WorkerUnavailable)) throw err;
    console.warn('Motor PDF sin Web Worker; se procesa en la página.', err.message);
    try {
      return await viaPage(await mainThread());
    } catch (e) {
      if (e?.code && MESSAGES[e.code]) throw new UserError(MESSAGES[e.code]);
      if (e?.code === 'range') throw new UserError(e.message);
      throw e;
    }
  }
}

const readFile = async (file) => new Uint8Array(await file.arrayBuffer());
export const workerAvailable = () => !broken;

/** Une PDF en orden. files: [{ name, file }] → { blob, pages } */
export function mergePdfs(files, onProgress) {
  return withFallback(
    async () => {
      const r = await call('merge', { files: files.map((f) => ({ name: f.name, blob: f.file })) }, onProgress);
      return { blob: pdfBlob(r.buffer), pages: r.pages };
    },
    async ({ core, PDFLib, qpdf }) => {
      const r = await core.merge(PDFLib, files.map((f) => ({ name: f.name, read: () => readFile(f.file) })), { qpdf, progress: onProgress });
      return { blob: pdfBlob(r.bytes), pages: r.pages };
    },
  );
}

/** Marca de agua. opts: { text, layout, size, opacity, color } → { blob, pages } */
export function watermarkPdf(file, opts, onProgress) {
  return withFallback(
    async () => {
      const r = await call('watermark', { blob: file, opts }, onProgress);
      return { blob: pdfBlob(r.buffer), pages: r.pages };
    },
    async ({ core, PDFLib, qpdf }) => {
      const r = await core.watermark(PDFLib, await readFile(file), opts, { qpdf, progress: onProgress });
      return { blob: pdfBlob(r.bytes), pages: r.pages };
    },
  );
}

/** Extrae páginas. groups: [[1,2,3]] o [[1],[2]] (números desde 1) → [Blob] */
export function extractPages(file, groups, onProgress) {
  return withFallback(
    async () => (await call('extract', { blob: file, groups }, onProgress)).buffers.map((b) => pdfBlob(b)),
    async ({ core, PDFLib, qpdf }) => (await core.extract(PDFLib, await readFile(file), groups, { qpdf, progress: onProgress })).outputs.map((b) => pdfBlob(b)),
  );
}

/** Optimización sin pérdida (qpdf): limpia y recomprime streams → Uint8Array o null */
export function optimizePdf(file, onProgress) {
  return withFallback(
    async () => {
      const r = await call('optimize', { blob: file }, onProgress);
      return r.buffer ? new Uint8Array(r.buffer) : null;
    },
    async ({ core, qpdf }) => (await core.optimize(await readFile(file), { qpdf, progress: onProgress })).bytes,
  );
}
