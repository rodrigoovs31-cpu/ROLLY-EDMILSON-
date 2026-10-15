import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, baseName, visualBox, visualToPdf, UserError } from '../lib.js';
import { h, field } from '../ui.js';

const FORMATS = [
  ['n', '1'],
  ['page-n', 'Página 1'],
  ['n-of', '1 / 10'],
  ['page-n-of', 'Página 1 de 10'],
  ['dash', '- 1 -'],
];
const fmt = (f, n, total) => ({
  'n': `${n}`, 'page-n': `Página ${n}`, 'n-of': `${n} / ${total}`, 'page-n-of': `Página ${n} de ${total}`, 'dash': `- ${n} -`,
})[f];

const POSITIONS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
const POS_LABEL = { tl: 'Arriba izquierda', tc: 'Arriba al centro', tr: 'Arriba derecha', bl: 'Abajo izquierda', bc: 'Abajo al centro', br: 'Abajo derecha' };

export default {
  accept: 'pdf',
  multiple: false,
  view: 'files',
  actionLabel: 'Numerar páginas',
  busyLabel: 'Numerando páginas…',

  options(ctx, el) {
    ctx.opts = { pos: 'bc', format: 'n', start: 1, size: 11, skipFirst: false };
    const posGrid = h('div.posgrid', { role: 'radiogroup', 'aria-label': 'Posición' },
      POSITIONS.map((p) => [
        h('input', { type: 'radio', name: 'num-pos', id: `num-pos-${p}`, value: p, checked: p === 'bc', onchange: () => { ctx.opts.pos = p; } }),
        h('label', { for: `num-pos-${p}`, title: POS_LABEL[p], 'aria-label': POS_LABEL[p] }, h('span')),
      ]).flat());
    el.append(
      field('Posición', h('div.posbox', {}, posGrid)),
      field('Formato', h('select.input#num-format', { onchange: (e) => { ctx.opts.format = e.target.value; } },
        FORMATS.map(([v, l]) => h('option', { value: v }, l)))),
      h('div.row2', {},
        field('Empezar en', h('input.input#num-start', { type: 'number', min: 0, value: 1, oninput: (e) => { ctx.opts.start = Number(e.target.value); } })),
        field('Tamaño', h('input.input#num-size', { type: 'number', min: 6, max: 48, value: 11, oninput: (e) => { ctx.opts.size = Number(e.target.value); } }))),
      h('label.check', {}, h('input#num-skip', { type: 'checkbox', onchange: (e) => { ctx.opts.skipFirst = e.target.checked; } }), 'No numerar la primera página (portada)'),
    );
  },

  validate(ctx) {
    if (!(ctx.opts.size >= 6 && ctx.opts.size <= 48)) return 'El tamaño debe estar entre 6 y 48.';
    if (!Number.isInteger(ctx.opts.start) || ctx.opts.start < 0) return 'El número inicial debe ser 0 o mayor.';
    return null;
  },

  async run(ctx) {
    const { StandardFonts, rgb, degrees } = await getPdfLib();
    const doc = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const first = ctx.opts.skipFirst ? 1 : 0;
    if (first >= pages.length) throw new UserError('El PDF solo tiene una página y elegiste no numerarla.');
    const total = ctx.opts.start + (pages.length - first) - 1;
    const size = ctx.opts.size;
    const margin = Math.max(18, size * 1.6);

    for (let i = first; i < pages.length; i++) {
      const page = pages[i];
      const vb = visualBox(page);
      const text = fmt(ctx.opts.format, ctx.opts.start + i - first, total);
      const tw = font.widthOfTextAtSize(text, size);
      const [v, hz] = ctx.opts.pos;
      const vx = hz === 'l' ? margin : hz === 'r' ? vb.width - margin - tw : (vb.width - tw) / 2;
      const vy = v === 'b' ? margin - size * 0.25 : vb.height - margin - size * 0.75;
      const { x, y } = visualToPdf(vb, vx, vy);
      page.drawText(text, { x, y, size, font, color: rgb(0.13, 0.14, 0.2), rotate: degrees(vb.rot) });
    }
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-numerado.pdf`, blob: pdfBlob(await doc.save()) }],
      summary: `Numeraste ${pages.length - first} ${pages.length - first === 1 ? 'página' : 'páginas'}.`,
    };
  },
};
