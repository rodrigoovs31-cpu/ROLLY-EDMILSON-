import { baseName } from '../lib.js';
import { extractPages } from '../pdf-engine.js';
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

  // Corre en el Web Worker.
  async run(ctx) {
    const base = baseName(ctx.files[0].name);
    const nums = [...ctx.pages.selectedNumbers()].sort((a, b) => a - b);
    const groups = ctx.opts.separate ? nums.map((n) => [n]) : [nums];
    const blobs = await extractPages(ctx.files[0].file, groups, (value, label) => ctx.progress(value, label));
    if (ctx.opts.separate) {
      const files = nums.map((n, i) => ({ name: `${base}-pagina-${n}.pdf`, blob: blobs[i] }));
      return { files, zipName: `${base}-paginas.zip`, summary: `Extrajiste ${nums.length} ${nums.length === 1 ? 'página' : 'páginas'}.` };
    }
    return {
      files: [{ name: `${base}-extracto.pdf`, blob: blobs[0] }],
      summary: `Tu nuevo PDF tiene ${nums.length} ${nums.length === 1 ? 'página' : 'páginas'}.`,
    };
  },
};
