import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, baseName } from '../lib.js';
import { h } from '../ui.js';
import { rangeField } from './_select.js';

let picker;

export default {
  accept: 'pdf',
  multiple: false,
  view: 'pages',
  pagesConfig: { select: 'keep', hint: 'Toca las páginas que quieres sacar' },
  actionLabel: 'Extraer páginas',
  busyLabel: 'Extrayendo páginas…',

  options(ctx, el) {
    ctx.opts = { separate: false };
    picker = rangeField(ctx, 'Páginas a extraer', 'Tócalas en la vista previa o escribe sus números.');
    el.append(picker.el,
      h('label.check', {}, h('input#extract-separate', { type: 'checkbox', onchange: (e) => { ctx.opts.separate = e.target.checked; } }),
        'Un PDF por cada página'));
  },

  onChange(ctx) {
    picker?.sync();
    ctx.setRunEnabled(ctx.pages.selectedNumbers().size > 0);
  },

  validate(ctx) {
    return ctx.pages.selectedNumbers().size ? null : 'Marca al menos una página para extraer.';
  },

  async run(ctx) {
    const { PDFDocument } = await getPdfLib();
    const src = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const base = baseName(ctx.files[0].name);
    const nums = [...ctx.pages.selectedNumbers()].sort((a, b) => a - b);
    const build = async (list) => {
      const out = await PDFDocument.create();
      (await out.copyPages(src, list.map((n) => n - 1))).forEach((p) => out.addPage(p));
      return pdfBlob(await out.save());
    };
    if (ctx.opts.separate) {
      const files = [];
      for (const n of nums) files.push({ name: `${base}-pagina-${n}.pdf`, blob: await build([n]) });
      return { files, zipName: `${base}-paginas.zip`, summary: `Extrajiste ${nums.length} ${nums.length === 1 ? 'página' : 'páginas'}.` };
    }
    return {
      files: [{ name: `${base}-extracto.pdf`, blob: await build(nums) }],
      summary: `Tu nuevo PDF tiene ${nums.length} ${nums.length === 1 ? 'página' : 'páginas'}.`,
    };
  },
};
