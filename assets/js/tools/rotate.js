import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, baseName } from '../lib.js';
import { h } from '../ui.js';

export default {
  accept: 'pdf',
  multiple: false,
  view: 'pages',
  pagesConfig: { rotate: true, hint: 'Toca una página para girarla' },
  actionLabel: 'Rotar PDF',
  busyLabel: 'Girando páginas…',

  options(ctx, el) {
    el.append(h('p.side-text', {}, 'Toca cada página que salió de lado para girarla 90°, o usa "Girar todas" arriba.'));
  },

  validate(ctx) {
    return ctx.pages.pages.some((p) => p.rotation) ? null : 'Gira al menos una página antes de guardar.';
  },

  async run(ctx) {
    const { degrees } = await getPdfLib();
    const doc = await loadPdfDoc(await readBytes(ctx.files[0].file));
    let count = 0;
    for (const p of ctx.pages.pages) {
      if (!p.rotation) continue;
      const page = doc.getPage(p.index);
      page.setRotation(degrees((page.getRotation().angle + p.rotation) % 360));
      count++;
    }
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-rotado.pdf`, blob: pdfBlob(await doc.save()) }],
      summary: `Giraste ${count} ${count === 1 ? 'página' : 'páginas'}.`,
    };
  },
};
