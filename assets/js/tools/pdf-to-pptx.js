import { loadLib, readBytes, openPdfjs, renderPage, canvasToBlob, freeCanvas, baseName, yieldUI } from '../lib.js';
import { h } from '../ui.js';

const blobToDataUrl = (blob) => new Promise((resolve) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.readAsDataURL(blob);
});

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Convertir a PowerPoint',
  busyLabel: 'Preparando las diapositivas…',

  options(ctx, el) {
    el.append(h('p.side-note', {}, 'Cada página del PDF queda como una diapositiva con la misma apariencia. El texto de la página se copia en las notas del orador.'));
  },

  async run(ctx) {
    const PptxGenJS = await loadLib('pptxgen');
    const files = [];
    const n = ctx.files.length;
    for (const [fi, entry] of ctx.files.entries()) {
      const doc = await openPdfjs(await readBytes(entry.file));
      try {
        const first = (await doc.getPage(1)).getViewport({ scale: 1 });
        const W = first.width / 72;
        const H = first.height / 72;
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'PDF', width: W, height: H });
        pptx.layout = 'PDF';
        for (let i = 1; i <= doc.numPages; i++) {
          ctx.progress((fi + i / doc.numPages) / n, `Diapositiva ${i} de ${doc.numPages}…`);
          await yieldUI();
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const canvas = await renderPage(page, 2);
          const data = await blobToDataUrl(await canvasToBlob(canvas, 'image/jpeg', 0.88));
          freeCanvas(canvas);
          const text = (await page.getTextContent()).items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('').trim();
          page.cleanup();
          const k = Math.min(W / (vp.width / 72), H / (vp.height / 72));
          const w = (vp.width / 72) * k;
          const hh = (vp.height / 72) * k;
          const slide = pptx.addSlide();
          slide.background = { color: 'FFFFFF' };
          slide.addImage({ data, x: (W - w) / 2, y: (H - hh) / 2, w, h: hh });
          if (text) slide.addNotes(text);
        }
        const blob = await pptx.write({ outputType: 'blob' });
        files.push({ name: `${baseName(entry.name)}.pptx`, blob });
      } finally {
        doc.destroy();
      }
    }
    return { files, zipName: 'maus-pdf-a-powerpoint.zip', summary: 'Tu presentación de PowerPoint está lista.' };
  },
};
