import {
  readBytes, getPdfLib, pdfBlob, baseName, fmtSize, openPdfjs, renderPage,
  canvasToBlob, freeCanvas, yieldUI, UserError,
} from '../lib.js';
import { optimizePdf } from '../pdf-engine.js';
import { h, field } from '../ui.js';

const LEVELS = {
  recommended: [{ scale: 1.4, quality: 0.62 }],
  extreme: [{ scale: 1.0, quality: 0.45 }],
};
const TARGET_STEPS = [
  { scale: 1.6, quality: 0.7 }, { scale: 1.4, quality: 0.6 }, { scale: 1.2, quality: 0.5 },
  { scale: 1.0, quality: 0.45 }, { scale: 0.85, quality: 0.35 }, { scale: 0.7, quality: 0.3 },
];

async function rasterize(doc, { scale, quality }, onPage) {
  const { PDFDocument } = await getPdfLib();
  const out = await PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    onPage(i);
    await yieldUI();
    const page = await doc.getPage(i);
    const size = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, scale);
    const jpg = await canvasToBlob(canvas, 'image/jpeg', quality);
    freeCanvas(canvas);
    page.cleanup();
    const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    const p = out.addPage([size.width, size.height]);
    p.drawImage(img, { x: 0, y: 0, width: size.width, height: size.height });
  }
  return out.save();
}

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Comprimir PDF',
  busyLabel: 'Comprimiendo…',

  options(ctx, el) {
    ctx.opts = { level: 'recommended', targetMb: 1 };
    const targetBox = h('div.stack', { hidden: true },
      field('Peso máximo (MB)',
        h('input.input#compress-target', { type: 'number', min: 0.1, step: 0.1, value: 1, inputmode: 'decimal', oninput: (e) => { ctx.opts.targetMb = Number(e.target.value); } }),
        'Ejemplo: si el portal pide "máximo 2 MB", escribe 2.'));
    const levels = h('div.levels', {}, [
      ['recommended', 'Recomendada', 'Buen equilibrio entre peso y calidad.'],
      ['extreme', 'Extrema', 'El menor peso posible. Menos nitidez.'],
      ['basic', 'Básica', 'Sin pérdida de calidad. El texto sigue siendo seleccionable.'],
      ['target', 'Tamaño máximo', 'Tú eliges el peso en MB y DocuMaus lo ajusta.'],
    ].map(([value, title, text]) => h('label.level', {},
      h('input', {
        type: 'radio', name: 'compress-level', value, checked: value === 'recommended',
        onchange: () => { ctx.opts.level = value; targetBox.hidden = value !== 'target'; },
      }),
      h('span.level-body', {}, h('strong', {}, title), h('span', {}, text)))));
    el.append(field('Nivel de compresión', levels), targetBox,
      h('p.side-note', {}, 'Las opciones Recomendada, Extrema y Tamaño máximo convierten las páginas en imagen. Son ideales para documentos escaneados y fotos.'));
  },

  validate(ctx) {
    if (ctx.opts.level === 'target' && !(ctx.opts.targetMb > 0)) return 'Escribe un peso máximo mayor que 0.';
    return null;
  },

  async run(ctx) {
    const results = [];
    const rows = [];
    const n = ctx.files.length;
    for (const [fi, entry] of ctx.files.entries()) {
      const label = n > 1 ? `Archivo ${fi + 1} de ${n}: ` : '';
      // El original se queda como File (no se copia a memoria si no hace falta).
      const original = entry.file;
      let best = original;
      let bestSize = original.size;
      let note = '';
      const consider = (bytes) => { if (bytes && bytes.length < bestSize) { best = bytes; bestSize = bytes.length; } };

      // Limpieza y recompresión de streams sin pérdida: corre en el Web Worker (qpdf).
      ctx.progress(fi / n, `${label}optimizando…`);
      const clean = await optimizePdf(original, (v) => ctx.progress((fi + v * 0.1) / n, `${label}limpiando y recomprimiendo…`));
      consider(clean);

      if (ctx.opts.level !== 'basic') {
        const doc = await openPdfjs(clean || await readBytes(original));
        const target = ctx.opts.level === 'target' ? ctx.opts.targetMb * 1024 * 1024 : 0;
        const steps = target ? TARGET_STEPS : LEVELS[ctx.opts.level];
        try {
          for (const [si, step] of steps.entries()) {
            if (target && bestSize <= target) break;
            const bytes = await rasterize(doc, step, (page) => {
              ctx.progress((fi + (si + page / doc.numPages) / steps.length) / n,
                `${label}comprimiendo página ${page} de ${doc.numPages}${target && si ? ` (intento ${si + 1})` : ''}…`);
            });
            consider(bytes);
          }
        } finally {
          doc.destroy();
        }
        if (target && bestSize > target) note = `No se pudo bajar de ${fmtSize(bestSize)} sin que el documento quede ilegible.`;
      }

      if (best === original) note ||= 'Este PDF ya estaba optimizado; no se pudo reducir más.';
      const saved = 1 - bestSize / original.size;
      results.push({ name: `${baseName(entry.name)}-comprimido.pdf`, blob: best === original ? new Blob([original], { type: 'application/pdf' }) : pdfBlob(best) });
      rows.push(h('li', {},
        h('span.cmp-name', {}, entry.name),
        h('span.cmp-sizes', {}, `${fmtSize(original.size)} → `, h('strong', {}, fmtSize(bestSize)),
          saved > 0.005 ? h('span.badge.ok', {}, `−${Math.round(saved * 100)}%`) : null),
        note ? h('span.cmp-note', {}, note) : null));
    }

    const totalBefore = ctx.files.reduce((s, f) => s + f.size, 0);
    const totalAfter = results.reduce((s, f) => s + f.blob.size, 0);
    if (!results.length) throw new UserError('No hay archivos para comprimir.');
    return {
      files: results,
      zipName: 'maus-comprimidos.zip',
      summary: totalAfter < totalBefore
        ? `Ahorraste ${fmtSize(totalBefore - totalAfter)} (${Math.round((1 - totalAfter / totalBefore) * 100)}% menos).`
        : 'Tus archivos ya estaban en su tamaño mínimo.',
      details: h('ul.cmp-list', {}, rows),
    };
  },
};
