import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, baseName } from '../lib.js';
import { h } from '../ui.js';

export default {
  accept: 'pdf',
  multiple: false,
  view: 'pages',
  pagesConfig: { rotate: true, remove: true, reorder: true, hint: 'Arrastra las páginas para ordenarlas' },
  actionLabel: 'Guardar cambios',
  busyLabel: 'Organizando tu PDF…',

  options(ctx, el) {
    el.append(h('p.side-text', {}, 'Arrastra las páginas para cambiar el orden. Usa los botones de cada página para girarla o eliminarla.'));
  },

  onChange(ctx) {
    ctx.setRunEnabled(ctx.pages && ctx.pages.pages.length > 0, 'El PDF debe tener al menos una página');
  },

  validate(ctx) {
    return ctx.pages.pages.length ? null : 'No puedes eliminar todas las páginas.';
  },

  async run(ctx) {
    const { PDFDocument, degrees } = await getPdfLib();
    const src = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const out = await PDFDocument.create();
    const list = ctx.pages.pages;
    const copied = await out.copyPages(src, list.map((p) => p.index));
    copied.forEach((page, i) => {
      const extra = list[i].rotation;
      if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360));
      out.addPage(page);
    });
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-organizado.pdf`, blob: pdfBlob(await out.save()) }],
      summary: `Tu PDF quedó con ${list.length} ${list.length === 1 ? 'página' : 'páginas'}.`,
    };
  },
};
