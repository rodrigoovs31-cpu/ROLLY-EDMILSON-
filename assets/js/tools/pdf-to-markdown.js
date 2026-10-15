import { baseName } from '../lib.js';
import { h, iconEl, toast } from '../ui.js';
import { readLayout, requireText } from '../text-layout.js';

const PREFIX = { h1: '# ', h2: '## ', h3: '### ', li: '- ', p: '' };

export function toMarkdown(layout, { pageMarks = false } = {}) {
  return layout.pages.map((page, i) => {
    const body = page.paragraphs.map((p) => PREFIX[p.kind] + p.text.replace(/([*_`#\\])/g, '\\$1')).join('\n\n');
    return pageMarks ? `<!-- Página ${i + 1} -->\n\n${body}` : body;
  }).filter(Boolean).join(pageMarks ? '\n\n---\n\n' : '\n\n');
}

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Convertir a Markdown',
  busyLabel: 'Leyendo tu PDF…',

  options(ctx, el) {
    ctx.opts = { pageMarks: false };
    el.append(
      h('label.check', {}, h('input#md-pages', { type: 'checkbox', onchange: (e) => { ctx.opts.pageMarks = e.target.checked; } }), 'Marcar dónde empieza cada página'),
      h('p.side-note', {}, 'Markdown es texto con formato simple. Es ideal para pegar un documento en ChatGPT, Claude, Notion u Obsidian sin perder títulos ni listas.'),
    );
  },

  async run(ctx) {
    const files = [];
    let preview = '';
    for (const [fi, entry] of ctx.files.entries()) {
      const layout = await readLayout(entry.file, (f, label) => ctx.progress((fi + f) / ctx.files.length, label));
      requireText(layout);
      const md = toMarkdown(layout, ctx.opts);
      if (!preview) preview = md;
      files.push({ name: `${baseName(entry.name)}.md`, blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }) });
    }
    const area = h('textarea.ocr-text#md-result', { readonly: true, rows: 12, 'aria-label': 'Markdown' }, preview.slice(0, 20000));
    const copy = h('button.btn.btn-ghost.sm', {
      type: 'button',
      onclick: async () => {
        try { await navigator.clipboard.writeText(preview); toast('Markdown copiado'); } catch { area.select(); toast('Selecciona el texto y cópialo con Ctrl+C'); }
      },
    }, iconEl('copy'), 'Copiar Markdown');
    return {
      files, zipName: 'maus-markdown.zip',
      summary: 'Tu Markdown está listo.',
      details: h('div.ocr-box', {}, area, copy),
    };
  },
};
