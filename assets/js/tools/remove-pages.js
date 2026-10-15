import { loadPdfDoc, readBytes, pdfBlob, baseName } from '../lib.js';
import { rangeField } from './_select.js';

let picker;

export default {
  accept: 'pdf',
  multiple: false,
  view: 'pages',
  pagesConfig: { select: 'delete', hint: 'Toca las páginas que quieres quitar' },
  actionLabel: 'Eliminar páginas',
  busyLabel: 'Eliminando páginas…',

  options(ctx, el) {
    picker = rangeField(ctx, 'Páginas a eliminar', 'Tócalas en la vista previa o escribe sus números.');
    el.append(picker.el);
  },

  onChange(ctx) {
    picker?.sync();
    const n = ctx.pages.selectedNumbers().size;
    ctx.setRunEnabled(n > 0 && n < ctx.pages.numPages);
  },

  validate(ctx) {
    const n = ctx.pages.selectedNumbers().size;
    if (!n) return 'Marca al menos una página para eliminar.';
    if (n >= ctx.pages.numPages) return 'No puedes eliminar todas las páginas.';
    return null;
  },

  async run(ctx) {
    const doc = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const remove = [...ctx.pages.selectedNumbers()].sort((a, b) => b - a);
    for (const n of remove) doc.removePage(n - 1);
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-editado.pdf`, blob: pdfBlob(await doc.save()) }],
      summary: `Quitaste ${remove.length} ${remove.length === 1 ? 'página' : 'páginas'}. Quedan ${doc.getPageCount()}.`,
    };
  },
};
