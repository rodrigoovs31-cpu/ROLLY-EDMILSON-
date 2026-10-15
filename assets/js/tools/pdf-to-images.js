import { readBytes, openPdfjs, renderPage, canvasToBlob, freeCanvas, baseName, yieldUI } from '../lib.js';
import { field, segmented } from '../ui.js';

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Convertir a imagen',
  busyLabel: 'Convirtiendo páginas…',

  options(ctx, el) {
    ctx.opts = { dpi: 150, format: 'jpg' };
    el.append(
      field('Calidad', segmented('img-dpi', [
        { value: '150', label: 'Normal (150 ppp)' }, { value: '300', label: 'Alta (300 ppp)' },
      ], '150', (v) => { ctx.opts.dpi = Number(v); })),
      field('Formato', segmented('img-format', [
        { value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' },
      ], 'jpg', (v) => { ctx.opts.format = v; }), 'JPG pesa menos. PNG mantiene la máxima nitidez.'),
    );
  },

  async run(ctx) {
    const files = [];
    const type = ctx.opts.format === 'png' ? 'image/png' : 'image/jpeg';
    const n = ctx.files.length;
    for (const [fi, entry] of ctx.files.entries()) {
      const doc = await openPdfjs(await readBytes(entry.file));
      const base = baseName(entry.name);
      try {
        for (let i = 1; i <= doc.numPages; i++) {
          ctx.progress((fi + i / doc.numPages) / n, `${n > 1 ? `${entry.name}: ` : ''}página ${i} de ${doc.numPages}…`);
          await yieldUI();
          const page = await doc.getPage(i);
          const canvas = await renderPage(page, ctx.opts.dpi / 72);
          const blob = await canvasToBlob(canvas, type, 0.92);
          freeCanvas(canvas);
          page.cleanup();
          const suffix = doc.numPages > 1 ? `-${String(i).padStart(String(doc.numPages).length, '0')}` : '';
          files.push({ name: `${base}${suffix}.${ctx.opts.format}`, blob });
        }
      } finally {
        doc.destroy();
      }
    }
    return {
      files,
      zipName: n === 1 ? `${baseName(ctx.files[0].name)}-imagenes.zip` : 'maus-imagenes.zip',
      summary: `Se crearon ${files.length} ${files.length === 1 ? 'imagen' : 'imágenes'}.`,
    };
  },
};
