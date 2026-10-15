import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, yieldUI } from '../lib.js';
import { h } from '../ui.js';

export default {
  accept: 'pdf',
  multiple: true,
  sortable: true,
  view: 'files',
  actionLabel: 'Unir PDF',
  busyLabel: 'Uniendo tus PDF…',

  options(ctx, el) {
    el.append(h('p.side-text', {}, 'Ordena los archivos arrastrándolos. Se unirán de izquierda a derecha y de arriba abajo.'));
  },

  onChange(ctx) {
    ctx.setRunEnabled(ctx.files.length >= 2, 'Añade al menos 2 archivos');
  },

  validate(ctx) {
    if (ctx.files.length < 2) return 'Añade al menos 2 PDF para unirlos.';
    return null;
  },

  async run(ctx) {
    const { PDFDocument } = await getPdfLib();
    const out = await PDFDocument.create();
    let total = 0;
    for (const [i, entry] of ctx.files.entries()) {
      ctx.progress(i / ctx.files.length, `Uniendo ${entry.name}…`);
      await yieldUI();
      const src = await loadPdfDoc(await readBytes(entry.file));
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      total += pages.length;
    }
    ctx.progress(0.95, 'Guardando…');
    const bytes = await out.save();
    return {
      files: [{ name: 'maus-unido.pdf', blob: pdfBlob(bytes) }],
      summary: `Uniste ${ctx.files.length} archivos en un PDF de ${total} páginas.`,
    };
  },
};
