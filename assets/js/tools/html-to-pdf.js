import { pdfBlob, baseName, UserError } from '../lib.js';
import { h, field, segmented, iconEl, toast } from '../ui.js';
import { elementsToPdf, waitForAssets } from '../render-html.js';

const A4 = { w: 794, hPx: 1123, wPt: 595.28, hPt: 841.89 };
const LETTER = { w: 816, hPx: 1056, wPt: 612, hPt: 792 };

// Dibuja el HTML en un marco aislado (sin ejecutar sus scripts) y lo devuelve.
async function renderFrame(html, width) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:1200px;border:0;background:#fff`;
  document.body.append(frame);
  await new Promise((resolve) => {
    frame.onload = resolve;
    frame.srcdoc = html;
    setTimeout(resolve, 6000);
  });
  const doc = frame.contentDocument;
  if (!doc?.body) throw new UserError('No pudimos leer ese HTML.');
  await waitForAssets(doc.body);
  // Con el marco casi sin alto, scrollHeight mide solo el contenido (no la ventana).
  frame.style.height = '1px';
  const height = Math.max(1, doc.documentElement.scrollHeight, doc.body.scrollHeight);
  frame.style.height = `${height}px`;
  if (!getComputedStyle(doc.body).backgroundColor || getComputedStyle(doc.body).backgroundColor === 'rgba(0, 0, 0, 0)') doc.body.style.background = '#fff';
  return { frame, doc, height };
}

export default {
  accept: 'html',
  multiple: false,
  view: 'files',
  actionLabel: 'Convertir a PDF',
  busyLabel: 'Dibujando la página…',

  // Permite pegar código HTML en vez de subir un archivo.
  selectExtras(drop, addFiles) {
    const area = h('textarea.input.code-input#html-code', { rows: 5, placeholder: '<h1>Hola</h1>\n<p>Pega aquí tu código HTML…</p>' });
    const go = h('button.btn.btn-ghost', {
      type: 'button',
      onclick: () => {
        if (!area.value.trim()) { toast('Pega primero tu código HTML.', 'error'); return; }
        addFiles([new File([area.value], 'codigo.html', { type: 'text/html' })]);
      },
    }, iconEl('file-code'), 'Usar este código');
    drop.append(h('div.paste-box', {}, h('p.drop-hint', {}, 'o pega tu código HTML'), area, go));
  },

  options(ctx, el) {
    ctx.opts = { size: 'a4' };
    el.append(
      field('Tamaño de página', segmented('html-size', [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }], 'a4', (v) => { ctx.opts.size = v; })),
      h('p.side-note', {}, 'Por seguridad, los scripts de la página no se ejecutan. Para convertir una página web, ábrela, presiona Ctrl+S, guárdala como "Página web, solo HTML" y súbela aquí.'),
    );
  },

  async run(ctx) {
    const entry = ctx.files[0];
    const size = ctx.opts.size === 'letter' ? LETTER : A4;
    const html = await entry.file.text();
    const { frame, doc } = await renderFrame(html, size.w);
    try {
      const bytes = await elementsToPdf([{ el: doc.documentElement, widthPt: size.wPt, heightPt: size.hPt, slicePx: size.hPx }], { progress: ctx.progress });
      return { files: [{ name: `${baseName(entry.name)}.pdf`, blob: pdfBlob(bytes) }], summary: 'Tu HTML ya es PDF.' };
    } finally {
      frame.remove();
    }
  },
};
