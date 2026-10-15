import { baseName } from '../lib.js';
import { h } from '../ui.js';
import { readLayout, requireText } from '../text-layout.js';
import { buildDocx } from '../docx-build.js';

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Convertir a Word',
  busyLabel: 'Leyendo tu PDF…',

  options(ctx, el) {
    ctx.opts = { pageBreaks: true };
    el.append(
      h('label.check', {}, h('input#word-breaks', { type: 'checkbox', checked: true, onchange: (e) => { ctx.opts.pageBreaks = e.target.checked; } }), 'Mantener los saltos de página'),
      h('p.side-note', {}, 'Recibes un Word editable con títulos, párrafos y viñetas. Los diseños con columnas o tablas complejas pueden cambiar. Si tu PDF es escaneado, pásalo antes por "OCR PDF".'),
    );
  },

  async run(ctx) {
    const files = [];
    const n = ctx.files.length;
    let paragraphs = 0;
    for (const [fi, entry] of ctx.files.entries()) {
      const layout = await readLayout(entry.file, (f, label) => ctx.progress((fi + f * 0.8) / n, label));
      requireText(layout);
      ctx.progress((fi + 0.9) / n, 'Armando el documento de Word…');
      paragraphs += layout.pages.reduce((s, p) => s + p.paragraphs.length, 0);
      const blob = await buildDocx(layout.pages, { pageBreaks: ctx.opts.pageBreaks, title: baseName(entry.name) });
      files.push({ name: `${baseName(entry.name)}.docx`, blob });
    }
    return { files, zipName: 'maus-pdf-a-word.zip', summary: `Tu Word editable está listo (${paragraphs} párrafos).` };
  },
};
