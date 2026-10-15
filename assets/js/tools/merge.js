import { mergePdfs } from '../pdf-engine.js';
import { h } from '../ui.js';

export default {
  accept: 'pdf',
  multiple: true,
  sortable: true,
  view: 'files',
  actionLabel: 'Unir PDF',
  busyLabel: 'Uniendo tus PDF…',

  options(ctx, el) {
    el.append(h('p.side-text', {}, 'Ordena los archivos arrastrándolos. Se unirán de izquierda a derecha y de arriba abajo.'));
  },

  onChange(ctx) {
    ctx.setRunEnabled(ctx.files.length >= 2, 'Añade al menos 2 archivos');
  },

  validate(ctx) {
    if (ctx.files.length < 2) return 'Añade al menos 2 PDF para unirlos.';
    return null;
  },

  // Corre en el Web Worker: la página no se congela aunque unas cientos de páginas.
  async run(ctx) {
    const { blob, pages } = await mergePdfs(
      ctx.files.map((entry) => ({ name: entry.name, file: entry.file })),
      (value, label) => ctx.progress(value, label),
    );
    return {
      files: [{ name: 'maus-unido.pdf', blob }],
      summary: `Uniste ${ctx.files.length} archivos en un PDF de ${pages} páginas.`,
    };
  },
};
