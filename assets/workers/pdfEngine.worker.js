/* Web Worker del motor PDF de Maus.
   Hace el trabajo pesado (unir, marca de agua, extraer páginas, optimizar) fuera del hilo
   principal: la página sigue respondiendo a 60 FPS mientras procesa documentos grandes.

   Protocolo (postMessage):
     página → worker  { type: 'init', libs }                       una vez
     página → worker  { id, op, payload }                          (los File/Blob se envían sin copiar sus datos)
     worker → página  { id, type: 'progress', value: 0..1, label }
     worker → página  { id, type: 'done', result }                  (el resultado se transfiere, sin copias)
     worker → página  { id, type: 'error', code, message } */
'use strict';

let libs = null;
let ready = null;
let qpdfFactory = null;
let qpdfWasm = [];

// Carga un script probando primero la CDN y luego la copia local.
function importFirst(urls) {
  let last;
  for (const url of urls) {
    try {
      importScripts(url);
      return url;
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error('sin URLs');
}

function init() {
  ready ??= (async () => {
    importFirst(libs.pdfLib);  // define self.PDFLib
    importFirst(libs.core);    // define self.MausPdfCore
    if (!self.PDFLib || !self.MausPdfCore) throw new Error('no se cargó el motor PDF');
  })();
  return ready;
}

// qpdf (WebAssembly) se carga solo cuando hace falta: pesa más de 1 MB.
async function getQpdf() {
  if (!qpdfFactory) {
    importFirst(libs.qpdf.js);
    if (typeof self.Module !== 'function') throw new Error('qpdf no se cargó');
    qpdfFactory = self.Module;
    qpdfWasm = libs.qpdf.wasm;
  }
  return async (args, inputs) => {
    const errors = [];
    const { log, error } = console;
    let instance;
    for (const url of qpdfWasm) {
      console.log = () => {};
      console.error = (...parts) => errors.push(parts.join(' '));
      try {
        instance = await qpdfFactory({ locateFile: () => url, noInitialRun: true });
        break;
      } catch (err) {
        if (url === qpdfWasm[qpdfWasm.length - 1]) throw err;
      } finally {
        console.log = log;
        console.error = error;
      }
    }
    for (const [name, bytes] of Object.entries(inputs)) instance.FS.writeFile(name, bytes);
    let code;
    try {
      code = instance.callMain(args);
    } catch (e) {
      code = typeof e?.status === 'number' ? e.status : 2;
    }
    const read = (name) => {
      try { return instance.FS.readFile(name); } catch { return null; }
    };
    return { code, errors, read };
  };
}

// El buffer de un Uint8Array que se puede transferir sin copiarlo.
const transferable = (u8) => (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer);
// Los archivos llegan como Blob/File (se envían sin copiar sus datos) y se leen aquí.
const readBlob = async (blob) => new Uint8Array(await blob.arrayBuffer());

const OPS = {
  async merge(p, ctx) {
    const files = p.files.map((f) => ({ name: f.name, read: () => readBlob(f.blob) }));
    const { bytes, pages } = await self.MausPdfCore.merge(self.PDFLib, files, ctx);
    const buffer = transferable(bytes);
    return { result: { buffer, pages }, transfer: [buffer] };
  },
  async watermark(p, ctx) {
    const { bytes, pages } = await self.MausPdfCore.watermark(self.PDFLib, await readBlob(p.blob), p.opts, ctx);
    const buffer = transferable(bytes);
    return { result: { buffer, pages }, transfer: [buffer] };
  },
  async extract(p, ctx) {
    const { outputs } = await self.MausPdfCore.extract(self.PDFLib, await readBlob(p.blob), p.groups, ctx);
    const buffers = outputs.map(transferable);
    return { result: { buffers }, transfer: buffers };
  },
  async optimize(p, ctx) {
    const { bytes } = await self.MausPdfCore.optimize(await readBlob(p.blob), ctx);
    const buffer = bytes ? transferable(bytes) : null;
    return { result: { buffer }, transfer: buffer ? [buffer] : [] };
  },
};

self.onmessage = async (event) => {
  const msg = event.data || {};
  if (msg.type === 'init') {
    libs = msg.libs;
    return;
  }
  const { id, op, payload } = msg;
  try {
    if (!libs) throw Object.assign(new Error('el worker no recibió la configuración'), { code: 'init' });
    await init().catch((err) => { throw Object.assign(new Error(err?.message || 'init'), { code: 'init' }); });
    const handler = OPS[op];
    if (!handler) throw new Error(`operación desconocida: ${op}`);
    const ctx = {
      // qpdf se descarga solo si de verdad se usa (optimizar o quitar restricciones).
      qpdf: async (args, inputs) => (await getQpdf())(args, inputs),
      progress: (value, label) => self.postMessage({ id, type: 'progress', value, label }),
    };
    const { result, transfer } = await handler(payload, ctx);
    self.postMessage({ id, type: 'done', result }, transfer);
  } catch (err) {
    self.postMessage({ id, type: 'error', code: err?.code || 'failed', message: err?.message || String(err) });
  }
};
