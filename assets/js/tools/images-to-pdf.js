import { readBytes, getPdfLib, pdfBlob, canvasToBlob, freeCanvas, yieldUI, UserError } from '../lib.js';
import { h, field, segmented } from '../ui.js';

const SIZES = { a4: [595.28, 841.89], letter: [612, 792] };
const MARGINS = { none: 0, small: 20, big: 40 };
const MAX_SIDE = 3000;

// Lee la orientación EXIF de un JPEG (1 = normal).
function jpegOrientation(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10;
      const le = b[t] === 0x49;
      const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
      const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
      const ifd = t + u32(t + 4);
      const count = u16(ifd);
      for (let k = 0; k < count; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112) return u16(e + 8) || 1;
      }
      return 1;
    }
    if (marker === 0xda) return 1;
    i += 2 + len;
  }
  return 1;
}

async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new UserError(`No se pudo abrir "${file.name}". Prueba con una imagen JPG o PNG.`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// Devuelve la imagen incrustada en el PDF con su tamaño en píxeles.
async function embed(out, entry) {
  const bytes = await readBytes(entry.file);
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (isPng) {
    try { const img = await out.embedPng(bytes); return img; } catch { /* se convierte abajo */ }
  }
  if (isJpg && jpegOrientation(bytes) === 1) {
    try { return await out.embedJpg(bytes); } catch { /* se convierte abajo */ }
  }
  const img = await loadImage(entry.file);
  const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * k);
  canvas.height = Math.round(img.naturalHeight * k);
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  freeCanvas(canvas);
  return out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
}

export default {
  accept: 'image',
  multiple: true,
  sortable: true,
  view: 'files',
  actionLabel: 'Convertir a PDF',
  busyLabel: 'Creando tu PDF…',

  options(ctx, el) {
    ctx.opts = { size: 'a4', orientation: 'auto', margin: 'small' };
    el.append(
      field('Tamaño de página', segmented('img-size', [
        { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }, { value: 'fit', label: 'Como la imagen' },
      ], 'a4', (v) => { ctx.opts.size = v; })),
      field('Orientación', segmented('img-orient', [
        { value: 'auto', label: 'Automática' }, { value: 'portrait', label: 'Vertical' }, { value: 'landscape', label: 'Horizontal' },
      ], 'auto', (v) => { ctx.opts.orientation = v; })),
      field('Margen', segmented('img-margin', [
        { value: 'none', label: 'Sin margen' }, { value: 'small', label: 'Pequeño' }, { value: 'big', label: 'Grande' },
      ], 'small', (v) => { ctx.opts.margin = v; })),
    );
  },

  async run(ctx) {
    const { PDFDocument } = await getPdfLib();
    const out = await PDFDocument.create();
    const n = ctx.files.length;
    for (const [i, entry] of ctx.files.entries()) {
      ctx.progress(i / n, `Agregando imagen ${i + 1} de ${n}…`);
      await yieldUI();
      const img = await embed(out, entry);
      const landscapeImg = img.width > img.height;
      let W, H;
      if (ctx.opts.size === 'fit') {
        const k = 841.89 / Math.max(img.width, img.height);
        W = img.width * k; H = img.height * k;
      } else {
        [W, H] = SIZES[ctx.opts.size];
        const wantLandscape = ctx.opts.orientation === 'landscape' || (ctx.opts.orientation === 'auto' && landscapeImg);
        if (wantLandscape) [W, H] = [H, W];
      }
      const m = ctx.opts.size === 'fit' ? 0 : MARGINS[ctx.opts.margin];
      const k = Math.min((W - 2 * m) / img.width, (H - 2 * m) / img.height);
      const w = img.width * k, hgt = img.height * k;
      out.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - hgt) / 2, width: w, height: hgt });
    }
    ctx.progress(0.97, 'Guardando…');
    return {
      files: [{ name: n === 1 ? `${ctx.files[0].name.replace(/\.[^.]+$/, '')}.pdf` : 'maus-imagenes.pdf', blob: pdfBlob(await out.save()) }],
      summary: `Convertiste ${n} ${n === 1 ? 'imagen' : 'imágenes'} en un PDF.`,
    };
  },
};
