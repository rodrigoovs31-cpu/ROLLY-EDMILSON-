import { loadLib, getJSZip, readBytes, pdfBlob, baseName, UserError } from '../lib.js';
import { h } from '../ui.js';
import { makeHost, waitForAssets, elementsToPdf } from '../render-html.js';

const EMU_PER_PT = 12700;

async function slideSize(bytes) {
  try {
    const JSZip = await getJSZip();
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('ppt/presentation.xml')?.async('string');
    const m = xml?.match(/<p:sldSz[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
    if (m) return { w: Number(m[1]) / EMU_PER_PT, h: Number(m[2]) / EMU_PER_PT };
  } catch { /* usa 16:9 */ }
  return { w: 960, h: 540 };
}

export default {
  accept: 'pptx',
  multiple: true,
  view: 'files',
  actionLabel: 'Convertir a PDF',
  busyLabel: 'Leyendo tu presentación…',

  options(ctx, el) {
    el.append(
      h('p.side-text', {}, 'Cada diapositiva se convierte en una página del PDF.'),
      h('p.side-note', {}, 'Las animaciones y los videos no se incluyen. Si usas fuentes especiales, se reemplazan por otras parecidas.'),
    );
  },

  async run(ctx) {
    const pptxPreview = await loadLib('pptxPreview');
    const files = [];
    const n = ctx.files.length;
    for (const [fi, entry] of ctx.files.entries()) {
      ctx.progress(fi / n, `Leyendo ${entry.name}…`);
      const bytes = await readBytes(entry.file);
      const size = await slideSize(bytes);
      const width = 1280;
      const height = Math.round((width * size.h) / size.w);
      const host = makeHost(width);
      try {
        const viewer = pptxPreview.init(host, { width, height, mode: 'list' });
        try {
          await viewer.preview(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        } catch { /* se revisa abajo si hay diapositivas */ }
        const wrapper = host.querySelector('.pptx-preview-wrapper');
        if (wrapper) Object.assign(wrapper.style, { height: 'auto', overflow: 'visible', background: '#fff' });
        await new Promise((r) => setTimeout(r, 300));
        await waitForAssets(host);
        const slides = [...host.querySelectorAll('.pptx-preview-slide-wrapper')];
        if (!slides.length) {
          throw new UserError(`No pudimos leer "${entry.name}". Ábrela en PowerPoint y guárdala otra vez como .pptx.`);
        }
        for (const s of slides) s.style.margin = '0';
        const pages = slides.map((el) => ({ el, widthPt: size.w, heightPt: size.h }));
        const pdf = await elementsToPdf(pages, { scale: 1.6, progress: (f, label) => ctx.progress((fi + f) / n, label) });
        files.push({ name: `${baseName(entry.name)}.pdf`, blob: pdfBlob(pdf) });
      } finally {
        host.remove();
      }
    }
    return { files, zipName: 'maus-powerpoint-a-pdf.zip', summary: n === 1 ? 'Tu presentación ya es PDF.' : `Convertiste ${n} presentaciones a PDF.` };
  },
};
