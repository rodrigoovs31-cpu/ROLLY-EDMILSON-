import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, parseRanges, baseName, yieldUI, UserError } from '../lib.js';
import { h, field, segmented } from '../ui.js';

export default {
  accept: 'pdf',
  multiple: false,
  view: 'files',
  actionLabel: 'Dividir PDF',
  busyLabel: 'Dividiendo tu PDF…',

  async options(ctx, el) {
    const info = await ctx.info(ctx.files[0]);
    const max = info.pages || 1;
    ctx.opts = { mode: 'ranges', ranges: max > 1 ? `1-${Math.ceil(max / 2)}, ${Math.ceil(max / 2) + 1}-${max}` : '1', every: 1, mergeRanges: false };

    const rangesBox = h('div.stack', {},
      field('Rangos de páginas',
        h('input.input#split-ranges', { type: 'text', value: ctx.opts.ranges, inputmode: 'numeric', oninput: (e) => { ctx.opts.ranges = e.target.value; } }),
        `Separa con comas. Ejemplo: 1-3, 4, 7-${max}. Cada rango será un PDF.`),
      h('label.check', {}, h('input#split-merge', { type: 'checkbox', onchange: (e) => { ctx.opts.mergeRanges = e.target.checked; } }), 'Juntar todos los rangos en un solo PDF'));
    const everyBox = h('div.stack', { hidden: true },
      field('Cada cuántas páginas',
        h('input.input#split-every', { type: 'number', min: 1, max, value: 1, oninput: (e) => { ctx.opts.every = Number(e.target.value); } }),
        `El PDF tiene ${max} páginas.`));

    el.append(
      field('Modo', segmented('split-mode', [
        { value: 'ranges', label: 'Por rangos' },
        { value: 'every', label: 'Cada N páginas' },
        { value: 'all', label: 'Todas sueltas' },
      ], 'ranges', (v) => {
        ctx.opts.mode = v;
        rangesBox.hidden = v !== 'ranges';
        everyBox.hidden = v !== 'every';
      })),
      rangesBox, everyBox);
  },

  async run(ctx) {
    const { PDFDocument } = await getPdfLib();
    const entry = ctx.files[0];
    const src = await loadPdfDoc(await readBytes(entry.file));
    const max = src.getPageCount();
    const base = baseName(entry.name);
    let groups;
    if (ctx.opts.mode === 'all') groups = Array.from({ length: max }, (_, i) => [i + 1, i + 1]);
    else if (ctx.opts.mode === 'every') {
      const n = Math.floor(ctx.opts.every);
      if (!(n >= 1)) throw new UserError('Escribe un número de páginas mayor que 0.');
      groups = [];
      for (let a = 1; a <= max; a += n) groups.push([a, Math.min(max, a + n - 1)]);
    } else groups = parseRanges(ctx.opts.ranges, max);

    if (ctx.opts.mode === 'ranges' && ctx.opts.mergeRanges) {
      const out = await PDFDocument.create();
      const idx = groups.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
      (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
      return {
        files: [{ name: `${base}-extracto.pdf`, blob: pdfBlob(await out.save()) }],
        summary: `Creaste un PDF con ${idx.length} páginas.`,
      };
    }

    const files = [];
    for (const [i, [a, b]] of groups.entries()) {
      ctx.progress(i / groups.length, `Creando archivo ${i + 1} de ${groups.length}…`);
      await yieldUI();
      const out = await PDFDocument.create();
      const idx = Array.from({ length: b - a + 1 }, (_, k) => a - 1 + k);
      (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
      files.push({ name: a === b ? `${base}-pagina-${a}.pdf` : `${base}-paginas-${a}-${b}.pdf`, blob: pdfBlob(await out.save()) });
    }
    return {
      files,
      zipName: `${base}-dividido.zip`,
      summary: files.length === 1 ? 'Tu PDF está listo.' : `Tu PDF se dividió en ${files.length} archivos.`,
    };
  },
};
