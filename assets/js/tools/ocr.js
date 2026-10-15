import { loadScript, readBytes, openPdfjs, renderPage, freeCanvas, baseName, UserError } from '../lib.js';
import { h, field, segmented, iconEl, toast } from '../ui.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

export default {
  accept: 'any',
  multiple: true,
  sortable: true,
  view: 'files',
  actionLabel: 'Reconocer texto',
  busyLabel: 'Preparando el reconocimiento…',

  options(ctx, el) {
    ctx.opts = { lang: 'spa' };
    el.append(
      field('Idioma del documento', segmented('ocr-lang', [
        { value: 'spa', label: 'Español' }, { value: 'eng', label: 'Inglés' }, { value: 'por', label: 'Portugués' }, { value: 'spa+eng', label: 'Español + Inglés' },
      ], 'spa', (v) => { ctx.opts.lang = v; })),
      h('p.side-note', {}, 'Funciona mejor con fotos nítidas y bien iluminadas. La primera vez se descarga el modelo del idioma (unos 2 a 10 MB).'),
    );
  },

  async run(ctx) {
    ctx.progress(0, 'Descargando el motor de OCR…');
    await loadScript(TESSERACT);
    let step = 0;
    let steps = 1;
    const worker = await window.Tesseract.createWorker(ctx.opts.lang, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') ctx.progress((step + m.progress) / steps, `Leyendo texto (${step + 1} de ${steps})…`);
        else if (/language|traineddata/.test(m.status)) ctx.progress(null, 'Descargando el modelo del idioma…');
      },
    }).catch(() => { throw new UserError('No se pudo cargar el OCR. Revisa tu conexión a internet e inténtalo otra vez.'); });

    const parts = [];
    try {
      // Cuenta las páginas a leer para mostrar el avance real.
      const jobs = [];
      for (const entry of ctx.files) {
        if (entry.kind === 'image') jobs.push({ entry });
        else {
          const doc = await openPdfjs(await readBytes(entry.file));
          for (let i = 1; i <= doc.numPages; i++) jobs.push({ entry, doc, page: i, last: i === doc.numPages });
        }
      }
      steps = jobs.length;
      for (const job of jobs) {
        let source = job.entry.file;
        let canvas;
        if (job.doc) {
          const page = await job.doc.getPage(job.page);
          canvas = await renderPage(page, 2.5);
          page.cleanup();
          source = canvas;
        }
        const { data } = await worker.recognize(source);
        if (canvas) freeCanvas(canvas);
        if (job.last) job.doc.destroy();
        const head = job.doc ? `${job.entry.name} · página ${job.page}` : job.entry.name;
        parts.push(steps > 1 ? `===== ${head} =====\n${data.text.trim()}` : data.text.trim());
        step++;
      }
    } finally {
      await worker.terminate();
    }

    const text = parts.join('\n\n').trim();
    const words = text ? text.split(/\s+/).length : 0;
    const area = h('textarea.ocr-text#ocr-result', { readonly: true, rows: 12, 'aria-label': 'Texto reconocido' }, text);
    const copy = h('button.btn.btn-ghost.sm', {
      type: 'button',
      onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('Texto copiado'); }
        catch { area.select(); toast('Selecciona el texto y cópialo con Ctrl+C'); }
      },
    }, iconEl('copy'), 'Copiar texto');
    const name = ctx.files.length === 1 ? `${baseName(ctx.files[0].name)}.txt` : 'maus-texto.txt';
    return {
      files: [{ name, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) }],
      summary: words ? `Reconocimos ${words} palabras.` : 'No encontramos texto. Prueba con una imagen más nítida.',
      details: h('div.ocr-box', {}, area, copy),
    };
  },
};
