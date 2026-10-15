/* Núcleo del motor PDF de DocuMaus: unir, marca de agua, extraer páginas y optimizar.
   Es un script clásico que funciona igual dentro del Web Worker (importScripts)
   y en la página como respaldo (si el navegador no pudiera abrir el worker).
   No toca el DOM: recibe la librería pdf-lib y devuelve bytes. */
(function (root) {
  'use strict';

  class EngineError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  // Avisa el avance como mucho cada 40 ms (evita inundar el hilo principal de mensajes).
  function throttle(report) {
    let last = 0;
    return (value, label, force) => {
      const now = Date.now();
      if (!force && now - last < 40) return;
      last = now;
      report(Math.max(0, Math.min(1, value)), label);
    };
  }

  // Abre un PDF. Si solo tiene restricciones (sin clave de apertura), las quita con qpdf.
  async function loadDoc(PDFLib, bytes, qpdf) {
    try {
      return await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    } catch (err) {
      if (!/encrypted/i.test(err && err.message)) throw new EngineError('damaged');
      if (!qpdf) throw new EngineError('password');
      const { code, read } = await qpdf(['--decrypt', '/in.pdf', '/out.pdf'], { '/in.pdf': bytes });
      const out = read('/out.pdf');
      if (code === 2 || !out) throw new EngineError('password');
      return PDFLib.PDFDocument.load(out, { updateMetadata: false });
    }
  }

  const u8 = (bytes) => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  // Une PDF en orden. Cada archivo se lee recién cuando le toca (files[i].read()) y se libera
  // apenas se copian sus páginas: en memoria nunca están todos los originales a la vez.
  async function merge(PDFLib, files, { qpdf, progress = () => {} } = {}) {
    const report = throttle(progress);
    const out = await PDFLib.PDFDocument.create();
    let pages = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      report(i / files.length * 0.85, `Uniendo ${f.name}…`, true);
      let src = await loadDoc(PDFLib, u8(await f.read()), qpdf);
      const indices = src.getPageIndices();
      const BATCH = 25;
      for (let b = 0; b < indices.length; b += BATCH) {
        const copied = await out.copyPages(src, indices.slice(b, b + BATCH));
        copied.forEach((p) => out.addPage(p));
        report((i + (b + BATCH) / indices.length) / files.length * 0.85, `Uniendo ${f.name}: página ${Math.min(b + BATCH, indices.length)} de ${indices.length}…`);
      }
      pages += indices.length;
      src = null;
    }
    report(0.88, 'Guardando el PDF…', true);
    const bytes = await out.save({ objectsPerTick: 200 });
    return { bytes, pages };
  }

  /* ---------- Geometría para páginas giradas ---------- */
  function visualBox(page) {
    const box = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    return { box, rot, width: swap ? box.height : box.width, height: swap ? box.width : box.height };
  }
  function visualToPdf(vb, vx, vy) {
    const { box, rot } = vb;
    const W = box.width, H = box.height;
    let x, y;
    if (rot === 90) { x = W - vy; y = vx; }
    else if (rot === 180) { x = W - vx; y = H - vy; }
    else if (rot === 270) { x = vy; y = H - vx; }
    else { x = vx; y = vy; }
    return { x: box.x + x, y: box.y + y };
  }
  function winAnsiSafe(font, text) {
    let out = '';
    for (const ch of text) {
      try { font.encodeText(ch); out += ch; } catch { /* carácter no soportado (emoji) */ }
    }
    return out.trim();
  }
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

  // Marca de agua: diagonal (por defecto), horizontal o en mosaico. Respeta las páginas giradas.
  async function watermark(PDFLib, bytes, opts, { qpdf, progress = () => {} } = {}) {
    const { StandardFonts, rgb, degrees } = PDFLib;
    const report = throttle(progress);
    const doc = await loadDoc(PDFLib, u8(bytes), qpdf);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const text = winAnsiSafe(font, String(opts.text || '')) || 'COPIA';
    const color = rgb(...hexToRgb(opts.color || '#9AA0B5'));
    const opacity = opts.opacity ?? 0.25;
    const pages = doc.getPages();
    pages.forEach((page, pi) => {
      const vb = visualBox(page);
      let size = opts.size || 60;
      const mosaic = opts.layout === 'mosaic';
      if (mosaic) size = Math.min(size, 36);
      let tw = font.widthOfTextAtSize(text, size);
      const angle = opts.layout === 'horizontal' ? 0 : (mosaic ? 30 : Math.atan2(vb.height, vb.width) * 180 / Math.PI);
      if (!mosaic) {
        const room = (angle ? Math.hypot(vb.width, vb.height) : vb.width) * 0.85;
        if (tw > room) { size *= room / tw; tw = room; }
      }
      const a = angle * Math.PI / 180;
      const stamp = (cx, cy) => {
        const vx = cx - (tw / 2) * Math.cos(a) + (size * 0.35) * Math.sin(a);
        const vy = cy - (tw / 2) * Math.sin(a) - (size * 0.35) * Math.cos(a);
        const { x, y } = visualToPdf(vb, vx, vy);
        page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees(vb.rot + angle) });
      };
      if (mosaic) {
        const stepX = tw + size * 3;
        const stepY = size * 5;
        for (let row = 0, cy = stepY / 2; cy < vb.height + stepY; cy += stepY, row++) {
          for (let cx = (row % 2) * stepX / 2; cx < vb.width + stepX; cx += stepX) stamp(cx, cy);
        }
      } else stamp(vb.width / 2, vb.height / 2);
      report((pi + 1) / pages.length * 0.85, `Marcando página ${pi + 1} de ${pages.length}…`);
    });
    report(0.88, 'Guardando el PDF…', true);
    return { bytes: await doc.save({ objectsPerTick: 200 }), pages: pages.length };
  }

  // Extrae páginas (números desde 1). groups: [[1,3,5]] → un PDF; [[1],[3],[5]] → un PDF por página.
  async function extract(PDFLib, bytes, groups, { qpdf, progress = () => {} } = {}) {
    const report = throttle(progress);
    const src = await loadDoc(PDFLib, u8(bytes), qpdf);
    const total = src.getPageCount();
    const outputs = [];
    for (let g = 0; g < groups.length; g++) {
      const list = groups[g].filter((n) => n >= 1 && n <= total);
      if (!list.length) throw new EngineError('range', 'Las páginas elegidas no existen en este PDF.');
      const out = await PDFLib.PDFDocument.create();
      (await out.copyPages(src, list.map((n) => n - 1))).forEach((p) => out.addPage(p));
      outputs.push(await out.save({ objectsPerTick: 200 }));
      report((g + 1) / groups.length, groups.length > 1 ? `Creando PDF ${g + 1} de ${groups.length}…` : 'Guardando el PDF…');
    }
    return { outputs };
  }

  // Optimización sin pérdida con qpdf: limpia y recomprime los streams, agrupa objetos.
  async function optimize(bytes, { qpdf, progress = () => {} } = {}) {
    if (!qpdf) throw new EngineError('unavailable');
    progress(0.1, 'Limpiando y recomprimiendo el PDF…');
    const { code, read } = await qpdf([
      '--object-streams=generate', '--compress-streams=y', '--recompress-flate',
      '--compression-level=9', '/in.pdf', '/out.pdf',
    ], { '/in.pdf': u8(bytes) });
    const out = read('/out.pdf');
    progress(1, null);
    return { bytes: code === 2 || !out ? null : out };
  }

  root.MausPdfCore = { EngineError, loadDoc, merge, watermark, extract, optimize, visualBox, visualToPdf };
})(typeof self !== 'undefined' ? self : globalThis);
