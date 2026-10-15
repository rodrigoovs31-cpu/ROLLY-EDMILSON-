import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, baseName, renderPage, canvasToBlob, freeCanvas, yieldUI, textSpan } from '../lib.js';
import { h, iconEl, field, segmented, toast } from '../ui.js';
import { mountEditor } from '../page-editor.js';

let editor;
const sizedOr = (b, w, hh) => (b.sized ? { x: b.x, y: b.y, w: b.w, h: b.h, sized: true } : { cx: b.x, cy: b.y, w, h: hh });
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const TOOLS = [
  { id: 'redact', label: 'Tapar zona', icon: 'square', mode: 'drag', sticky: true, make: (b) => ({ type: 'redact', ...sizedOr(b, 0.25, 0.03) }) },
  { id: 'select', label: 'Mover', icon: 'mouse-pointer-2', mode: 'select' },
];

// Busca un texto en todas las páginas y crea recuadros sobre cada coincidencia.
async function findMatches(term) {
  const q = norm(term.trim());
  if (q.length < 2) return 0;
  let found = 0;
  for (let i = 1; i <= editor.doc.numPages; i++) {
    const page = await editor.doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const it of content.items) {
      const text = norm(it.str || '');
      let from = 0;
      while (text && (from = text.indexOf(q, from)) !== -1) {
        const [a, b, c, d, , f] = it.transform;
        const size = Math.hypot(c, d) || Math.hypot(a, b);
        const { x0, x1 } = textSpan(it, from, from + q.length, content.styles);
        const [rx0, ry0, rx1, ry1] = vp.convertToViewportRectangle([x0, f - size * 0.28, x1, f + size * 0.95]);
        const x = Math.min(rx0, rx1) / vp.width;
        const y = Math.min(ry0, ry1) / vp.height;
        editor.add({ type: 'redact', page: i - 1, x: Math.max(0, x - 0.003), y: Math.max(0, y - 0.002), w: Math.abs(rx1 - rx0) / vp.width + 0.006, h: Math.abs(ry1 - ry0) / vp.height + 0.004, sized: true });
        found++;
        from += q.length;
      }
    }
    page.cleanup();
  }
  editor.select(null);
  return found;
}

export default {
  accept: 'pdf',
  multiple: false,
  view: 'custom',
  actionLabel: 'Censurar PDF',
  busyLabel: 'Censurando…',

  async mountView(ctx) {
    editor?.destroy();
    editor = await mountEditor(ctx, {
      tools: TOOLS,
      hint: 'Arrastra sobre lo que quieres tapar',
      renderObject: (obj, el) => el.append(h('div.ed-shape.ed-redact')),
      onChange: () => {
        const n = editor.objects.length;
        ctx.setRunEnabled(n > 0, 'Marca al menos una zona');
        if (count) count.textContent = n ? `${n} ${n === 1 ? 'zona marcada' : 'zonas marcadas'}` : 'Aún no marcas ninguna zona';
      },
    });
    ctx.setRunEnabled(false, 'Marca al menos una zona');
  },

  async options(ctx, el) {
    ctx.opts = { dpi: 150, cleanMeta: true };
    const search = h('input.input#redact-search', { type: 'search', placeholder: 'Ej: 12345678 o Juan Pérez' });
    const go = h('button.btn.btn-ghost.sm', {
      type: 'button',
      onclick: async () => {
        if (search.value.trim().length < 2) { toast('Escribe al menos 2 letras o números.', 'error'); return; }
        go.disabled = true;
        const n = await findMatches(search.value);
        go.disabled = false;
        toast(n ? `Se taparon ${n} coincidencias en el documento.` : 'No encontramos ese texto en el PDF.', n ? 'info' : 'error');
      },
    }, iconEl('search'), 'Buscar y tapar');
    count = h('p.field-status', { 'aria-live': 'polite' }, 'Aún no marcas ninguna zona');
    el.append(
      field('Buscar texto para tapar', h('div.stack', {}, search, go), 'Tapa todas las veces que aparece: un DNI, un nombre, un número de cuenta.'),
      count,
      field('Calidad de las páginas censuradas', segmented('redact-dpi', [
        { value: '150', label: 'Normal' }, { value: '220', label: 'Alta' },
      ], '150', (v) => { ctx.opts.dpi = Number(v); })),
      h('label.check', {}, h('input#redact-meta', { type: 'checkbox', checked: true, onchange: (e) => { ctx.opts.cleanMeta = e.target.checked; } }), 'Borrar autor, título y otros datos ocultos'),
      h('p.side-note', {}, 'Las páginas censuradas se guardan como imagen: el texto tapado se elimina de verdad y nadie puede copiarlo ni recuperarlo.'),
    );
    await editor.render();
  },

  validate() {
    return editor.objects.length ? null : 'Marca al menos una zona para tapar.';
  },

  async run(ctx) {
    const { PDFDocument } = await getPdfLib();
    const src = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const out = await PDFDocument.create();
    const byPage = new Map();
    for (const o of editor.objects) byPage.set(o.page, [...(byPage.get(o.page) || []), o]);
    const total = editor.doc.numPages;
    for (let i = 0; i < total; i++) {
      const boxes = byPage.get(i);
      if (!boxes) {
        const [copy] = await out.copyPages(src, [i]);
        out.addPage(copy);
        continue;
      }
      ctx.progress(i / total, `Censurando página ${i + 1} de ${total}…`);
      await yieldUI();
      const page = await editor.doc.getPage(i + 1);
      const size = page.getViewport({ scale: 1 });
      const canvas = await renderPage(page, ctx.opts.dpi / 72);
      const c = canvas.getContext('2d');
      c.fillStyle = '#000';
      for (const b of boxes) c.fillRect(b.x * canvas.width, b.y * canvas.height, b.w * canvas.width, b.h * canvas.height);
      const jpg = await canvasToBlob(canvas, 'image/jpeg', 0.9);
      freeCanvas(canvas);
      const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      out.addPage([size.width, size.height]).drawImage(img, { x: 0, y: 0, width: size.width, height: size.height });
    }
    if (ctx.opts.cleanMeta) {
      out.setTitle(''); out.setAuthor(''); out.setSubject(''); out.setKeywords([]);
      out.setCreator('DocuMaus'); out.setProducer('DocuMaus');
    } else {
      out.setTitle(src.getTitle() || ''); out.setAuthor(src.getAuthor() || '');
    }
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-censurado.pdf`, blob: pdfBlob(await out.save()) }],
      summary: `Tapaste ${editor.objects.length} ${editor.objects.length === 1 ? 'zona' : 'zonas'} en ${byPage.size} ${byPage.size === 1 ? 'página' : 'páginas'}.`,
    };
  },

  reset() {
    editor?.destroy();
    editor = null;
  },
};

let count;
