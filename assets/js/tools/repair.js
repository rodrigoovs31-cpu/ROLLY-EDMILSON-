import { readBytes, runQpdf, getPdfLib, openPdfjs, renderPage, canvasToBlob, freeCanvas, pdfBlob, baseName, yieldUI, UserError } from '../lib.js';
import { h } from '../ui.js';

// Último recurso: dibuja cada página que PDF.js logre leer y arma un PDF nuevo.
async function rescueAsImages(bytes, progress) {
  const { PDFDocument } = await getPdfLib();
  const doc = await openPdfjs(bytes);
  const out = await PDFDocument.create();
  let ok = 0;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      progress(i / doc.numPages);
      await yieldUI();
      try {
        const page = await doc.getPage(i);
        const size = page.getViewport({ scale: 1 });
        const canvas = await renderPage(page, 2);
        const jpg = await canvasToBlob(canvas, 'image/jpeg', 0.9);
        freeCanvas(canvas);
        const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
        out.addPage([size.width, size.height]).drawImage(img, { x: 0, y: 0, width: size.width, height: size.height });
        ok++;
      } catch { /* página ilegible: se salta */ }
    }
  } finally {
    doc.destroy();
  }
  if (!ok) throw new Error('sin páginas');
  return { bytes: await out.save(), pages: ok, total: doc.numPages };
}

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Reparar PDF',
  busyLabel: 'Reparando…',

  options(ctx, el) {
    el.append(h('p.side-text', {}, 'DocuMaus reconstruye la estructura del archivo. Si está muy dañado, rescata las páginas que se puedan leer.'));
  },

  async run(ctx) {
    const { PDFDocument } = await getPdfLib();
    const files = [];
    const rows = [];
    const n = ctx.files.length;
    for (const [fi, entry] of ctx.files.entries()) {
      ctx.progress(fi / n, `Reparando ${entry.name}…`);
      const bytes = await readBytes(entry.file);
      let result = null;
      let note = '';
      const { code, errors, read } = await runQpdf(['--object-streams=preserve', '/in.pdf', '/out.pdf'], { '/in.pdf': bytes });
      const fixed = read('/out.pdf');
      if (errors.some((e) => /password/i.test(e))) throw new UserError(`"${entry.name}" tiene contraseña. Quítasela primero con "Desbloquear PDF".`);
      if (code !== 2 && fixed) {
        try {
          await PDFDocument.load(fixed, { ignoreEncryption: true });
          result = fixed;
          note = code === 3 ? 'Se corrigieron errores en la estructura del archivo.' : 'El archivo estaba sano; se guardó una copia limpia.';
        } catch { /* se intenta el rescate */ }
      }
      if (!result) {
        // Segundo intento: leer el archivo objeto por objeto (sin depender de su índice dañado) y guardarlo limpio.
        try {
          const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
          if (!doc.isEncrypted && doc.getPageCount() > 0) {
            result = await doc.save();
            await PDFDocument.load(result);
            note = 'Se reconstruyó la estructura del archivo. El texto se conserva.';
          }
        } catch { result = null; }
      }
      if (!result) {
        try {
          const rescued = await rescueAsImages(bytes, (f) => ctx.progress((fi + f) / n, `Rescatando páginas de ${entry.name}…`));
          result = rescued.bytes;
          note = `Se rescataron ${rescued.pages} de ${rescued.total} páginas (como imagen).`;
        } catch {
          throw new UserError(`"${entry.name}" está demasiado dañado: no se pudo recuperar ninguna página.`);
        }
      }
      files.push({ name: `${baseName(entry.name)}-reparado.pdf`, blob: pdfBlob(result) });
      rows.push(h('li', {}, h('span.cmp-name', {}, entry.name), h('span.cmp-note', {}, note)));
    }
    return { files, zipName: 'maus-reparados.zip', summary: 'Tu PDF está reparado.', details: h('ul.cmp-list', {}, rows) };
  },
};
