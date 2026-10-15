import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, baseName, visualBox, visualToPdf, winAnsiSafe } from '../lib.js';
import { h, field, segmented } from '../ui.js';

const COLORS = [
  ['#9AA0B5', 'Gris'], ['#E5484D', 'Rojo'], ['#2F7BEB', 'Azul'], ['#14A37F', 'Verde'], ['#16182B', 'Negro'],
];
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

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

  async run(ctx) {
    const { StandardFonts, rgb, degrees } = await getPdfLib();
    const files = [];
    const n = ctx.files.length;
    for (const [fi, entry] of ctx.files.entries()) {
      ctx.progress(fi / n, n > 1 ? `Archivo ${fi + 1} de ${n}…` : null);
      const doc = await loadPdfDoc(await readBytes(entry.file));
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const text = winAnsiSafe(font, ctx.opts.text.trim()) || 'COPIA';
      const color = rgb(...hexToRgb(ctx.opts.color));

      for (const page of doc.getPages()) {
        const vb = visualBox(page);
        let size = ctx.opts.size;
        const mosaic = ctx.opts.layout === 'mosaic';
        if (mosaic) size = Math.min(size, 36);
        let tw = font.widthOfTextAtSize(text, size);
        const angle = ctx.opts.layout === 'horizontal' ? 0 : (mosaic ? 30 : Math.atan2(vb.height, vb.width) * 180 / Math.PI);
        if (!mosaic) {
          const room = (angle ? Math.hypot(vb.width, vb.height) : vb.width) * 0.85;
          if (tw > room) { size *= room / tw; tw = room; }
        }
        const a = angle * Math.PI / 180;
        const stamp = (cx, cy) => {
          // ancla para que el centro del texto quede en (cx, cy)
          const vx = cx - (tw / 2) * Math.cos(a) + (size * 0.35) * Math.sin(a);
          const vy = cy - (tw / 2) * Math.sin(a) - (size * 0.35) * Math.cos(a);
          const { x, y } = visualToPdf(vb, vx, vy);
          page.drawText(text, { x, y, size, font, color, opacity: ctx.opts.opacity, rotate: degrees(vb.rot + angle) });
        };
        if (mosaic) {
          const stepX = tw + size * 3;
          const stepY = size * 5;
          for (let row = 0, cy = stepY / 2; cy < vb.height + stepY; cy += stepY, row++) {
            for (let cx = (row % 2) * stepX / 2; cx < vb.width + stepX; cx += stepX) stamp(cx, cy);
          }
        } else stamp(vb.width / 2, vb.height / 2);
      }
      files.push({ name: `${baseName(entry.name)}-marca.pdf`, blob: pdfBlob(await doc.save()) });
    }
    return { files, zipName: 'maus-marca-de-agua.zip', summary: 'Tu marca de agua está en todas las páginas.' };
  },
};
