import { loadScript, readBytes, openPdfjs, renderPage, freeCanvas, canvasToBlob, getPdfLib, loadPdfDoc, pdfBlob, baseName, visualBox, visualToPdf, UserError } from '../lib.js';
import { h, field, segmented, iconEl, toast } from '../ui.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const TESSERACT_SRI = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';
const IMAGE_DPI = 150;

export default {
  accept: 'any',
  multiple: true,
  sortable: true,
  view: 'files',
  actionLabel: 'Reconocer texto',
  busyLabel: 'Preparando el reconocimiento…',

  options(ctx, el) {
    ctx.opts = { lang: 'spa', output: 'pdf' };
    el.append(
      field('Idioma del documento', segmented('ocr-lang', [
        { value: 'spa', label: 'Español' }, { value: 'eng', label: 'Inglés' }, { value: 'por', label: 'Portugués' }, { value: 'spa+eng', label: 'Español + Inglés' },
      ], 'spa', (v) => { ctx.opts.lang = v; })),
      field('Resultado', segmented('ocr-output', [
        { value: 'pdf', label: 'PDF con texto buscable' }, { value: 'text', label: 'Solo el texto' },
      ], 'pdf', (v) => { ctx.opts.output = v; }), 'El PDF buscable se ve igual que el original, pero ahora puedes buscar, seleccionar y copiar su texto.'),
      h('p.side-note', {}, 'Funciona mejor con escaneos nítidos y bien iluminados. La primera vez se descarga el modelo del idioma (unos 2 a 10 MB).'),
    );
  },

  async run(ctx) {
    ctx.progress(0, 'Descargando el motor de OCR…');
    await loadScript(TESSERACT, TESSERACT_SRI);
    let step = 0;
    let steps = 1;
    const worker = await window.Tesseract.createWorker(ctx.opts.lang, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') ctx.progress((step + m.progress) / steps, `Leyendo texto (${step + 1} de ${steps})…`);
        else if (/language|traineddata/.test(m.status)) ctx.progress(null, 'Descargando el modelo del idioma…');
      },
    }).catch(() => { throw new UserError('No se pudo cargar el OCR. Revisa tu conexión a internet e inténtalo otra vez.'); });

    const wantPdf = ctx.opts.output === 'pdf';
    const { PDFDocument, degrees } = await getPdfLib();
    const out = wantPdf ? await PDFDocument.create() : null;
    const parts = [];
    let skipped = 0;
    try {
      // Cuenta las páginas a leer para mostrar el avance real.
      const jobs = [];
      for (const entry of ctx.files) {
        if (entry.kind === 'image') jobs.push({ entry });
        else {
          const bytes = await readBytes(entry.file);
          const doc = await openPdfjs(bytes);
          const src = wantPdf ? await loadPdfDoc(bytes) : null;
          for (let i = 1; i <= doc.numPages; i++) jobs.push({ entry, doc, src, page: i, last: i === doc.numPages });
        }
      }
      steps = jobs.length;
      for (const job of jobs) {
        const head = job.doc ? `${job.entry.name} · página ${job.page}` : job.entry.name;
        let canvas;
        let source = job.entry.file;
        let existingText = '';
        if (job.doc) {
          const page = await job.doc.getPage(job.page);
          existingText = (await page.getTextContent()).items.map((it) => it.str).join(' ').trim();
          if (!(wantPdf && existingText.length > 40)) {
            canvas = await renderPage(page, 2.5);
            source = canvas;
          }
          page.cleanup();
        }

        if (wantPdf && job.doc && existingText.length > 40) {
          // La página ya tiene texto: se copia tal cual.
          skipped++;
          const [copy] = await out.copyPages(job.src, [job.page - 1]);
          out.addPage(copy);
          parts.push(existingText);
        } else {
          const { data } = await worker.recognize(source, { pdfTitle: baseName(job.entry.name), pdfTextOnly: true }, { text: true, pdf: wantPdf });
          parts.push(steps > 1 ? `===== ${head} =====\n${data.text.trim()}` : data.text.trim());
          if (wantPdf) {
            const [layer] = await out.embedPdf(data.pdf);
            if (job.doc) {
              const [copy] = await out.copyPages(job.src, [job.page - 1]);
              out.addPage(copy);
              const vb = visualBox(copy);
              const { x, y } = visualToPdf(vb, 0, 0);
              copy.drawPage(layer, { x, y, width: vb.width, height: vb.height, rotate: degrees(vb.rot) });
            } else {
              const img = new Image();
              const url = URL.createObjectURL(job.entry.file);
              img.src = url;
              await img.decode();
              const c = document.createElement('canvas');
              c.width = img.naturalWidth; c.height = img.naturalHeight;
              const g = c.getContext('2d');
              g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
              g.drawImage(img, 0, 0);
              URL.revokeObjectURL(url);
              const jpg = await out.embedJpg(new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.9)).arrayBuffer()));
              freeCanvas(c);
              const W = (img.naturalWidth * 72) / IMAGE_DPI;
              const H = (img.naturalHeight * 72) / IMAGE_DPI;
              const page = out.addPage([W, H]);
              page.drawImage(jpg, { x: 0, y: 0, width: W, height: H });
              page.drawPage(layer, { x: 0, y: 0, width: W, height: H });
            }
          }
        }
        if (canvas) freeCanvas(canvas);
        if (job.last) job.doc.destroy();
        step++;
      }
    } finally {
      await worker.terminate();
    }

    const text = parts.join('\n\n').trim();
    const words = text ? text.split(/\s+/).length : 0;
    const area = h('textarea.ocr-text#ocr-result', { readonly: true, rows: 10, 'aria-label': 'Texto reconocido' }, text);
    const copy = h('button.btn.btn-ghost.sm', {
      type: 'button',
      onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('Texto copiado'); }
        catch { area.select(); toast('Selecciona el texto y cópialo con Ctrl+C'); }
      },
    }, iconEl('copy'), 'Copiar texto');
    const base = ctx.files.length === 1 ? baseName(ctx.files[0].name) : 'maus-ocr';
    const files = wantPdf
      ? [{ name: `${base}-ocr.pdf`, blob: pdfBlob(await out.save()) }]
      : [{ name: `${base}.txt`, blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) }];
    return {
      files,
      summary: words
        ? `Reconocimos ${words} palabras${skipped ? ` (${skipped} ${skipped === 1 ? 'página ya tenía' : 'páginas ya tenían'} texto)` : ''}.`
        : 'No encontramos texto. Prueba con una imagen más nítida.',
      details: h('div.ocr-box', {}, area, copy),
    };
  },
};
