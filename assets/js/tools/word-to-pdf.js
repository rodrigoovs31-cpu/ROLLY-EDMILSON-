import { loadLib, readBytes, pdfBlob, baseName, UserError } from '../lib.js';
import { h } from '../ui.js';
import { makeHost, waitForAssets, elementsToPdf } from '../render-html.js';

const PX_TO_PT = 0.75;

export default {
  accept: 'docx',
  multiple: true,
  view: 'files',
  actionLabel: 'Convertir a PDF',
  busyLabel: 'Leyendo tu documento…',

  options(ctx, el) {
    el.append(
      h('p.side-text', {}, 'Cada página de tu Word se convierte en una página del PDF, con su mismo diseño.'),
      h('p.side-note', {}, 'Si tu documento usa fuentes especiales que no están en este equipo, se reemplazan por otras parecidas.'),
    );
  },

  async run(ctx) {
    const docxPreview = await loadLib('docxPreview');
    const files = [];
    const n = ctx.files.length;
    for (const [fi, entry] of ctx.files.entries()) {
      const host = makeHost();
      try {
        ctx.progress(fi / n, `Leyendo ${entry.name}…`);
        try {
          await docxPreview.renderAsync(await readBytes(entry.file), host, null, {
            className: 'docx', inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false,
            useBase64URL: true, experimental: true, renderHeaders: true, renderFooters: true,
            renderFootnotes: true, renderEndnotes: true,
          });
        } catch {
          throw new UserError(`No pudimos leer "${entry.name}". Ábrelo en Word y guárdalo otra vez como .docx.`);
        }
        await waitForAssets(host);
        const sections = [...host.querySelectorAll('section.docx')];
        if (!sections.length) throw new UserError(`"${entry.name}" está vacío.`);
        const pages = sections.map((s) => {
          const style = getComputedStyle(s);
          const pageH = parseFloat(style.minHeight) || s.offsetHeight;
          return { el: s, widthPt: s.offsetWidth * PX_TO_PT, heightPt: pageH * PX_TO_PT, slicePx: pageH };
        });
        const bytes = await elementsToPdf(pages, { progress: (f, label) => ctx.progress((fi + f) / n, label) });
        files.push({ name: `${baseName(entry.name)}.pdf`, blob: pdfBlob(bytes) });
      } finally {
        host.remove();
      }
    }
    return { files, zipName: 'maus-word-a-pdf.zip', summary: n === 1 ? 'Tu documento de Word ya es PDF.' : `Convertiste ${n} documentos a PDF.` };
  },
};
