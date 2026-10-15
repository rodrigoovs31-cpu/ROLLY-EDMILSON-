import { getPdfLib, pdfBlob, canvasToBlob, freeCanvas, yieldUI } from '../lib.js';
import { h, field, segmented } from '../ui.js';
import { addImagePage, loadImage } from './images-to-pdf.js';

const MAX_SIDE = 2400;

// Convierte la foto en "documento escaneado" según el filtro elegido.
function applyFilter(canvas, filter) {
  const c = canvas.getContext('2d');
  const { width: w, height: hgt } = canvas;
  const img = c.getImageData(0, 0, w, hgt);
  const d = img.data;
  const n = w * hgt;

  if (filter === 'original') return;
  if (filter === 'color') {
    // Niveles automáticos: estira el rango de cada canal ignorando el 1% de los extremos.
    for (let ch = 0; ch < 3; ch++) {
      const hist = new Uint32Array(256);
      for (let i = ch; i < d.length; i += 4) hist[d[i]]++;
      let lo = 0, hi = 255, acc = 0;
      while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
      acc = 0;
      while (hi > 0 && (acc += hist[hi]) < n * 0.01) hi--;
      const span = Math.max(1, hi - lo);
      for (let i = ch; i < d.length; i += 4) d[i] = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / span));
    }
    c.putImageData(img, 0, 0);
    return;
  }

  const gray = new Uint8ClampedArray(n);
  for (let i = 0, p = 0; p < n; i += 4, p++) gray[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

  if (filter === 'gray') {
    const hist = new Uint32Array(256);
    for (const v of gray) hist[v]++;
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) < n * 0.01) lo++;
    acc = 0;
    while (hi > 0 && (acc += hist[hi]) < n * 0.04) hi--;
    const span = Math.max(1, hi - lo);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const v = Math.max(0, Math.min(255, ((gray[p] - lo) * 255) / span));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  } else {
    // Blanco y negro con umbral adaptativo (Bradley): elimina sombras y fondo gris del papel.
    const integral = new Float64Array((w + 1) * (hgt + 1));
    for (let y = 1; y <= hgt; y++) {
      let row = 0;
      for (let x = 1; x <= w; x++) {
        row += gray[(y - 1) * w + (x - 1)];
        integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
      }
    }
    const s = Math.max(8, Math.floor(Math.max(w, hgt) / 16) >> 1);
    const t = 0.13;
    for (let y = 0; y < hgt; y++) {
      const y0 = Math.max(0, y - s), y1 = Math.min(hgt - 1, y + s);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - s), x1 = Math.min(w - 1, x + s);
        const count = (x1 - x0 + 1) * (y1 - y0 + 1);
        const sum = integral[(y1 + 1) * (w + 1) + (x1 + 1)] - integral[y0 * (w + 1) + (x1 + 1)] - integral[(y1 + 1) * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
        const v = gray[y * w + x] * count < sum * (1 - t) ? 0 : 255;
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
  }
  c.putImageData(img, 0, 0);
}

export default {
  accept: 'image',
  multiple: true,
  sortable: true,
  view: 'files',
  actionLabel: 'Crear PDF',
  busyLabel: 'Escaneando tus fotos…',

  options(ctx, el) {
    ctx.opts = { filter: 'bw', size: 'a4', orientation: 'portrait', margin: 'none' };
    const preview = () => { ctx.area.dataset.filter = ctx.opts.filter; };
    preview();
    el.append(
      field('Acabado', segmented('scan-filter', [
        { value: 'bw', label: 'Documento B/N' }, { value: 'gray', label: 'Escala de grises' },
        { value: 'color', label: 'Color mejorado' }, { value: 'original', label: 'Original' },
      ], 'bw', (v) => { ctx.opts.filter = v; preview(); }), '"Documento B/N" quita sombras y deja el fondo blanco, como un escáner.'),
      field('Tamaño de página', segmented('scan-size', [
        { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }, { value: 'fit', label: 'Como la foto' },
      ], 'a4', (v) => { ctx.opts.size = v; })),
      h('p.side-note', {}, 'Consejo: toma la foto de frente, con buena luz y la hoja ocupando casi toda la pantalla.'),
    );
  },

  async run(ctx) {
    const { PDFDocument } = await getPdfLib();
    const out = await PDFDocument.create();
    const n = ctx.files.length;
    for (const [i, entry] of ctx.files.entries()) {
      ctx.progress(i / n, `Mejorando hoja ${i + 1} de ${n}…`);
      await yieldUI();
      const img = await loadImage(entry.file);
      const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * k);
      canvas.height = Math.round(img.naturalHeight * k);
      const c = canvas.getContext('2d', { willReadFrequently: true });
      c.fillStyle = '#fff';
      c.fillRect(0, 0, canvas.width, canvas.height);
      c.drawImage(img, 0, 0, canvas.width, canvas.height);
      applyFilter(canvas, ctx.opts.filter);
      const bw = ctx.opts.filter === 'bw';
      const blob = await canvasToBlob(canvas, bw ? 'image/png' : 'image/jpeg', 0.85);
      freeCanvas(canvas);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const embedded = bw ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      addImagePage(out, embedded, ctx.opts);
    }
    ctx.progress(0.97, 'Guardando…');
    return {
      files: [{ name: 'maus-escaneo.pdf', blob: pdfBlob(await out.save()) }],
      summary: `Escaneaste ${n} ${n === 1 ? 'hoja' : 'hojas'} en un PDF.`,
    };
  },

  reset(ctx) {
    delete ctx.area.dataset.filter;
  },
};
