import { loadPdfDoc, readBytes, pdfBlob, baseName, visualBox, visualToPdf } from '../lib.js';
import { h, iconEl, field, segmented, toast } from '../ui.js';
import { mountEditor } from '../page-editor.js';

let editor;
let crop;
let lastCanvas;

// Busca el contenido (lo que no es blanco) en el canvas de la página para recortar los márgenes.
function contentBounds(canvas) {
  const c = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = c.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 600));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (data[i] < 235 || data[i + 1] < 235 || data[i + 2] < 235) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 0.015;
  return {
    x: Math.max(0, x0 / width - pad), y: Math.max(0, y0 / height - pad),
    w: Math.min(1, (x1 - x0) / width + pad * 2), h: Math.min(1, (y1 - y0) / height + pad * 2),
  };
}

export default {
  accept: 'pdf',
  multiple: false,
  view: 'custom',
  actionLabel: 'Recortar PDF',
  busyLabel: 'Recortando…',

  async mountView(ctx) {
    editor?.destroy();
    crop = { type: 'crop', x: 0.08, y: 0.08, w: 0.84, h: 0.84, sized: true, page: 0 };
    editor = await mountEditor(ctx, {
      tools: [{ id: 'select', label: 'Mover', icon: 'mouse-pointer-2', mode: 'select' }],
      hint: 'Mueve las esquinas para elegir la zona que quieres conservar',
      renderObject: (obj, el) => el.append(h('div.ed-crop')),
      deletable: () => false,
      onPage: (i, canvas) => { crop.page = i; lastCanvas = canvas; },
    });
    editor.add(crop);
  },

  async options(ctx, el) {
    ctx.opts = { scope: 'all' };
    el.append(
      field('Aplicar a', segmented('crop-scope', [
        { value: 'all', label: 'Todas las páginas' }, { value: 'current', label: 'Solo esta página' },
      ], 'all', (v) => { ctx.opts.scope = v; })),
      h('button.btn.btn-ghost.btn-block', {
        type: 'button',
        onclick: () => {
          const b = lastCanvas && contentBounds(lastCanvas);
          if (!b) { toast('No encontramos contenido en esta página.', 'error'); return; }
          Object.assign(crop, b);
          editor.update(crop);
          toast('Ajustamos el recorte al contenido de la página.');
        },
      }, iconEl('maximize'), 'Quitar márgenes blancos'),
      h('p.side-note', {}, 'Lo que queda fuera del recuadro se oculta en el PDF. Si recortas todas las páginas, se usa la misma zona en cada una.'),
    );
    await editor.render();
  },

  async run(ctx) {
    const doc = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const pages = ctx.opts.scope === 'all' ? doc.getPages() : [doc.getPage(editor.page)];
    for (const page of pages) {
      const vb = visualBox(page);
      const a = visualToPdf(vb, crop.x * vb.width, vb.height - crop.y * vb.height);
      const b = visualToPdf(vb, (crop.x + crop.w) * vb.width, vb.height - (crop.y + crop.h) * vb.height);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x), hh = Math.abs(a.y - b.y);
      page.setMediaBox(x, y, w, hh);
      page.setCropBox(x, y, w, hh);
      page.setTrimBox(x, y, w, hh);
      page.setBleedBox(x, y, w, hh);
      page.setArtBox(x, y, w, hh);
    }
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-recortado.pdf`, blob: pdfBlob(await doc.save()) }],
      summary: `Recortaste ${pages.length} ${pages.length === 1 ? 'página' : 'páginas'}.`,
    };
  },

  reset() {
    editor?.destroy();
    editor = null;
  },
};
