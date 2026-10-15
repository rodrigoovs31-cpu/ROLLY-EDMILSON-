import { baseName } from '../lib.js';
import { watermarkPdf } from '../pdf-engine.js';
import { h, field, segmented } from '../ui.js';

const COLORS = [
  ['#9AA0B5', 'Gris'], ['#E5484D', 'Rojo'], ['#2F7BEB', 'Azul'], ['#14A37F', 'Verde'], ['#16182B', 'Negro'],
];

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Poner marca de agua',
  busyLabel: 'Agregando marca de agua…',

  options(ctx, el) {
    ctx.opts = { text: 'CONFIDENCIAL', layout: 'diagonal', size: 60, opacity: 0.25, color: COLORS[0][0] };
    const opacityOut = h('output', {}, '25%');
    el.append(
      field('Texto', h('input.input#wm-text', { type: 'text', value: ctx.opts.text, maxlength: 60, oninput: (e) => { ctx.opts.text = e.target.value; } })),
      field('Posición', segmented('wm-layout', [
        { value: 'diagonal', label: 'Diagonal' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'mosaic', label: 'Mosaico' },
      ], 'diagonal', (v) => { ctx.opts.layout = v; })),
      field('Color', h('div.swatches', { role: 'radiogroup' }, COLORS.map(([c, name], i) => [
        h('input', { type: 'radio', name: 'wm-color', id: `wm-color-${i}`, value: c, checked: i === 0, onchange: () => { ctx.opts.color = c; } }),
        h('label', { for: `wm-color-${i}`, title: name, 'aria-label': name, style: `--sw:${c}` }),
      ]).flat())),
      h('div.row2', {},
        field('Tamaño', h('input.input#wm-size', { type: 'number', min: 10, max: 200, value: 60, oninput: (e) => { ctx.opts.size = Number(e.target.value); } })),
        field('Transparencia', h('div.range', {},
          h('input#wm-opacity', { type: 'range', min: 5, max: 100, value: 25, oninput: (e) => { ctx.opts.opacity = e.target.value / 100; opacityOut.textContent = `${e.target.value}%`; } }),
          opacityOut))),
    );
  },

  validate(ctx) {
    if (!ctx.opts.text.trim()) return 'Escribe el texto de la marca de agua.';
    if (!(ctx.opts.size >= 10 && ctx.opts.size <= 200)) return 'El tamaño debe estar entre 10 y 200.';
    return null;
  },

  // Corre en el Web Worker (el dibujo de la marca está en assets/workers/pdf-core.js).
  async run(ctx) {
    const files = [];
    const n = ctx.files.length;
    for (const [fi, entry] of ctx.files.entries()) {
      const { blob } = await watermarkPdf(entry.file, { ...ctx.opts, text: ctx.opts.text.trim() },
        (value, label) => ctx.progress((fi + value) / n, n > 1 ? `Archivo ${fi + 1} de ${n}: ${label || ''}` : label));
      files.push({ name: `${baseName(entry.name)}-marca.pdf`, blob });
    }
    return { files, zipName: 'maus-marca-de-agua.zip', summary: 'Tu marca de agua está en todas las páginas.' };
  },
};
