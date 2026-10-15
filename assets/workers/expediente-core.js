/* Armador de expedientes de DocuMaus (judiciales, notariales y licitaciones).
   Script clásico: se carga después de pdf-core.js, en el Web Worker o en la página.

   Arma, en este orden:
     carátula → índice de anexos → escrito principal → [separador] + ANEXO 1-A → ANEXO 1-B …
   y luego:
     - resalta en amarillo #FFFF00 (modo "multiplicar": el texto sigue legible) las zonas marcadas
     - pone la etiqueta "ANEXO 1-A" en la primera hoja de cada anexo
     - folia todas las hojas arriba a la derecha: "FOLIO: 001" con borde rojo
   Todo se dibuja dentro del contenido de cada página (no son comentarios que se puedan borrar). */
(function (root) {
  'use strict';
  const core = root.MausPdfCore;
  if (!core) throw new Error('Falta pdf-core.js');
  const { EngineError, loadDoc, visualBox, visualToPdf } = core;

  const A4 = [595.28, 841.89];
  const M = { left: 62, right: 56, top: 78, bottom: 64 };   // márgenes de carátula, índice y separadores
  const COLORS = {
    red: [0.82, 0.04, 0.04],
    ink: [0.09, 0.1, 0.17],
    muted: [0.36, 0.38, 0.45],
    line: [0.78, 0.8, 0.85],
    head: [0.93, 0.94, 0.96],
    label: [0.07, 0.2, 0.45],
  };

  /* ---------- Texto ---------- */

  // Solo caracteres que las fuentes estándar del PDF pueden escribir (español sí, emojis no).
  function safe(font, text) {
    let out = '';
    for (const ch of String(text ?? '').replace(/\r/g, '').replace(/\t/g, ' ')) {
      if (ch === '\n') { out += ch; continue; }
      try { font.encodeText(ch); out += ch; } catch { /* se omite */ }
    }
    return out;
  }

  // Parte un texto en líneas que entran en `width` (respeta los saltos de línea del usuario).
  function wrap(font, text, size, width) {
    const lines = [];
    for (const para of safe(font, text).split('\n')) {
      const words = para.split(/ +/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = '';
      for (const word of words) {
        const tryLine = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(tryLine, size) <= width) { line = tryLine; continue; }
        if (line) lines.push(line);
        // Palabra más larga que la línea: se corta por letras.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width) {
          let n = rest.length - 1;
          while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
          lines.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      lines.push(line);
    }
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  }

  const pad = (n, digits) => String(n).padStart(digits, '0');

  /* ---------- Etiquetas: ANEXO 1-A, 1-B … 1-Z, 1-AA … ---------- */

  function letters(i) {
    let s = '';
    let n = i + 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function anexoLabel(i, { style = 'letter', number = 1 } = {}) {
    return style === 'number' ? `ANEXO ${number + i}` : `ANEXO ${number}-${letters(i)}`;
  }

  /* ---------- Dibujo con giro: "arriba a la derecha" tal como se ve la hoja ---------- */

  // Dibuja un recuadro con texto en la página, en coordenadas visibles (origen abajo-izquierda).
  function drawStamp(PDFLib, page, vb, { x, y, w, h, text, font, size, color, fill = [1, 1, 1], border = 1.2, double = false }) {
    const { rgb, degrees } = PDFLib;
    const rot = degrees(vb.rot);
    const rect = (rx, ry, rw, rh, opts) => {
      const p = visualToPdf(vb, rx, ry);
      page.drawRectangle({ x: p.x, y: p.y, width: rw, height: rh, rotate: rot, ...opts });
    };
    rect(x, y, w, h, { color: rgb(...fill), borderColor: rgb(...color), borderWidth: border });
    if (double) rect(x + 2.2, y + 2.2, w - 4.4, h - 4.4, { borderColor: rgb(...color), borderWidth: 0.6 });
    const tw = font.widthOfTextAtSize(text, size);
    const t = visualToPdf(vb, x + (w - tw) / 2, y + (h - size * 0.72) / 2);
    page.drawText(text, { x: t.x, y: t.y, size, font, color: rgb(...color), rotate: rot });
  }

  // Resaltado fluorescente: rectángulos en fracciones de la hoja visible (x, y desde arriba a la izquierda).
  function drawHighlights(PDFLib, page, rects) {
    const { rgb, BlendMode } = PDFLib;
    const vb = visualBox(page);
    for (const r of rects) {
      const x = Math.max(0, Math.min(1, r.x)), y = Math.max(0, Math.min(1, r.y));
      const w = Math.max(0, Math.min(1 - x, r.w)), h = Math.max(0, Math.min(1 - y, r.h));
      if (w < 0.002 || h < 0.002) continue;
      const a = visualToPdf(vb, x * vb.width, vb.height - y * vb.height);
      const b = visualToPdf(vb, (x + w) * vb.width, vb.height - (y + h) * vb.height);
      page.drawRectangle({
        x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
        width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
        color: rgb(1, 1, 0),                 // #FFFF00
        blendMode: BlendMode.Multiply,       // el texto negro sigue viéndose encima del amarillo
      });
    }
  }

  /* ---------- Índice de anexos (se mide antes de dibujar para saber cuántas hojas ocupa) ---------- */

  const COL = { label: 84, folios: 78 };
  const TABLE_W = A4[0] - M.left - M.right;
  const DESC_W = TABLE_W - COL.label - COL.folios;
  const CELL = 7;

  function measureRows(rows, f) {
    return rows.map((r) => {
      const desc = wrap(f.bold, r.desc || '—', 10, DESC_W - CELL * 2);
      const purpose = r.purpose ? wrap(f.regular, `Finalidad probatoria: ${r.purpose}`, 9, DESC_W - CELL * 2) : [];
      const labelLines = wrap(f.bold, r.label, 9.5, COL.label - CELL * 2);
      const textH = desc.length * 13 + (purpose.length ? 4 + purpose.length * 11.5 : 0);
      return { ...r, desc, purpose, labelLines, height: Math.max(textH, labelLines.length * 12.5) + CELL * 2 };
    });
  }

  function paginateRows(rows) {
    const pages = [[]];
    const firstTop = A4[1] - M.top - 64;   // la primera hoja lleva el título
    const otherTop = A4[1] - M.top - 30;
    let y = firstTop - 24;                  // encabezado de la tabla
    for (const r of rows) {
      if (y - r.height < M.bottom && pages[pages.length - 1].length) {
        pages.push([]);
        y = otherTop - 24;
      }
      pages[pages.length - 1].push(r);
      y -= r.height;
    }
    return pages;
  }

  function drawIndexPage(PDFLib, page, rows, f, { first, title, subtitle }) {
    const { rgb } = PDFLib;
    let y = A4[1] - M.top;
    if (first) {
      const t = safe(f.bold, title);
      page.drawText(t, { x: (A4[0] - f.bold.widthOfTextAtSize(t, 16)) / 2, y: y - 16, size: 16, font: f.bold, color: rgb(...COLORS.ink) });
      if (subtitle) {
        const s = wrap(f.regular, subtitle, 10, TABLE_W)[0] || '';
        page.drawText(s, { x: (A4[0] - f.regular.widthOfTextAtSize(s, 10)) / 2, y: y - 36, size: 10, font: f.regular, color: rgb(...COLORS.muted) });
      }
      y -= 64;
    } else {
      page.drawText(safe(f.bold, `${title} (continuación)`), { x: M.left, y: y - 12, size: 11, font: f.bold, color: rgb(...COLORS.muted) });
      y -= 30;
    }
    // Encabezado de la tabla
    page.drawRectangle({ x: M.left, y: y - 24, width: TABLE_W, height: 24, color: rgb(...COLORS.head), borderColor: rgb(...COLORS.line), borderWidth: 0.8 });
    const headers = [['ANEXO', M.left], ['DESCRIPCIÓN Y OBJETO DE PRUEBA', M.left + COL.label], ['FOLIOS', M.left + COL.label + DESC_W]];
    for (const [text, x] of headers) page.drawText(safe(f.bold, text), { x: x + CELL, y: y - 16, size: 8.5, font: f.bold, color: rgb(...COLORS.ink) });
    y -= 24;
    for (const r of rows) {
      page.drawRectangle({ x: M.left, y: y - r.height, width: TABLE_W, height: r.height, borderColor: rgb(...COLORS.line), borderWidth: 0.8 });
      for (const x of [M.left + COL.label, M.left + COL.label + DESC_W]) {
        page.drawLine({ start: { x, y }, end: { x, y: y - r.height }, thickness: 0.8, color: rgb(...COLORS.line) });
      }
      let ty = y - CELL - 9.5;
      for (const line of r.labelLines) {
        page.drawText(line, { x: M.left + CELL, y: ty, size: 9.5, font: f.bold, color: rgb(...COLORS.label) });
        ty -= 12.5;
      }
      ty = y - CELL - 10;
      for (const line of r.desc) {
        page.drawText(line, { x: M.left + COL.label + CELL, y: ty, size: 10, font: f.bold, color: rgb(...COLORS.ink) });
        ty -= 13;
      }
      if (r.purpose.length) ty -= 4;
      for (const line of r.purpose) {
        page.drawText(line, { x: M.left + COL.label + CELL, y: ty + 1.5, size: 9, font: f.regular, color: rgb(...COLORS.muted) });
        ty -= 11.5;
      }
      const folios = safe(f.regular, r.folios || '');
      page.drawText(folios, { x: M.left + COL.label + DESC_W + CELL, y: y - CELL - 10, size: 9.5, font: f.regular, color: rgb(...COLORS.ink) });
      y -= r.height;
    }
  }

  /* ---------- Carátula ---------- */

  function drawCover(PDFLib, page, f, cover, summary) {
    const { rgb } = PDFLib;
    const W = A4[0];
    const width = W - M.left - M.right;
    const center = (text, y, font, size, color = COLORS.ink) => {
      for (const line of wrap(font, text, size, width)) {
        page.drawText(line, { x: (W - font.widthOfTextAtSize(line, size)) / 2, y, size, font, color: rgb(...color) });
        y -= size * 1.35;
      }
      return y;
    };
    let y = A4[1] - M.top - 10;
    if (cover.court) y = center(cover.court.toUpperCase(), y, f.bold, 13) - 6;
    page.drawLine({ start: { x: M.left, y }, end: { x: W - M.right, y }, thickness: 1.2, color: rgb(...COLORS.ink) });
    y -= 30;

    const fields = [
      ['Expediente N.°', cover.caseNumber],
      ['Materia / Proceso', cover.matter],
      ['Presentado por', cover.party],
    ].filter(([, v]) => v && String(v).trim());
    for (const [k, v] of fields) {
      page.drawText(safe(f.bold, `${k}:`), { x: M.left, y, size: 11, font: f.bold, color: rgb(...COLORS.muted) });
      const lines = wrap(f.regular, v, 11, width - 128);
      for (const line of lines) {
        page.drawText(line, { x: M.left + 128, y, size: 11, font: f.regular, color: rgb(...COLORS.ink) });
        y -= 16;
      }
      y -= 6;
    }

    y = Math.min(y, A4[1] * 0.62) - 20;
    y = center((cover.title || 'EXPEDIENTE').toUpperCase(), y, f.bold, 22) - 10;
    if (cover.sumilla) {
      const lines = wrap(f.regular, cover.sumilla, 11, width - 36);
      const boxH = 30 + lines.length * 15;
      page.drawRectangle({ x: M.left, y: y - boxH, width, height: boxH, borderColor: rgb(...COLORS.line), borderWidth: 1 });
      page.drawText('SUMILLA:', { x: M.left + 18, y: y - 20, size: 10, font: f.bold, color: rgb(...COLORS.muted) });
      let ly = y - 36;
      for (const line of lines) {
        page.drawText(line, { x: M.left + 18, y: ly, size: 11, font: f.regular, color: rgb(...COLORS.ink) });
        ly -= 15;
      }
      y -= boxH + 18;
    }

    // Resumen del contenido al pie
    let by = M.bottom + 70;
    for (const line of summary) {
      page.drawText(safe(f.regular, line), { x: M.left, y: by, size: 10, font: f.regular, color: rgb(...COLORS.muted) });
      by -= 15;
    }
    if (cover.placeDate) center(cover.placeDate, M.bottom + 96, f.regular, 11);
  }

  /* ---------- Separador de anexo ---------- */

  function drawSeparator(PDFLib, page, f, anexo, folios) {
    const { rgb } = PDFLib;
    const W = A4[0];
    const width = W - M.left - M.right;
    let y = A4[1] * 0.62;
    const label = safe(f.bold, anexo.label);
    page.drawText(label, { x: (W - f.bold.widthOfTextAtSize(label, 40)) / 2, y, size: 40, font: f.bold, color: rgb(...COLORS.label) });
    y -= 46;
    for (const line of wrap(f.bold, anexo.title || '', 16, width)) {
      page.drawText(line, { x: (W - f.bold.widthOfTextAtSize(line, 16)) / 2, y, size: 16, font: f.bold, color: rgb(...COLORS.ink) });
      y -= 22;
    }
    if (anexo.purpose) {
      y -= 18;
      page.drawText('FINALIDAD PROBATORIA:', { x: M.left, y, size: 10, font: f.bold, color: rgb(...COLORS.muted) });
      y -= 18;
      for (const line of wrap(f.regular, anexo.purpose, 12, width)) {
        page.drawText(line, { x: M.left, y, size: 12, font: f.regular, color: rgb(...COLORS.ink) });
        y -= 17;
      }
    }
    if (folios) {
      const t = safe(f.regular, `Folios ${folios}`);
      page.drawText(t, { x: (W - f.regular.widthOfTextAtSize(t, 10)) / 2, y: M.bottom + 20, size: 10, font: f.regular, color: rgb(...COLORS.muted) });
    }
  }

  /* ---------- Armado ---------- */

  /**
   * files: [{ name, read: () => Promise<Uint8Array> }]
   * job: {
   *   main: { file, pages: [n…] | null } | null,
   *   anexos: [{ file, pages: [n…] | null, label, title, purpose, highlights: { [páginaOriginal]: [{x,y,w,h}] } }],
   *   cover: { enabled, court, caseNumber, matter, title, sumilla, party, placeDate },
   *   index: { enabled, title }, separators, stampLabels,
   *   folio: { enabled, start, order: 'asc'|'desc', includeFront, prefix },
   *   lock, preview
   * }
   */
  async function expediente(PDFLib, files, job, { qpdf, progress = () => {} } = {}) {
    const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
    const report = (() => {
      let last = 0;
      return (v, label, force) => { const now = Date.now(); if (force || now - last > 40) { last = now; progress(Math.max(0, Math.min(1, v)), label); } };
    })();
    const anexos = job.anexos || [];
    if (!job.main && !anexos.length) throw new EngineError('empty', 'Agrega el escrito principal o al menos un medio probatorio.');

    const out = await PDFDocument.create();
    const f = {
      regular: await out.embedFont(StandardFonts.Helvetica),
      bold: await out.embedFont(StandardFonts.HelveticaBold),
    };

    // 1) Cuántas hojas aporta cada parte (sin copiar todavía).
    const uses = new Map();   // archivo → cuántas partes lo usan (para liberar memoria al terminar)
    const parts = [];
    if (job.main) parts.push({ kind: 'main', ...job.main });
    anexos.forEach((a) => parts.push({ kind: 'anexo', ...a }));
    for (const p of parts) uses.set(p.file, (uses.get(p.file) || 0) + 1);

    const docs = new Map();
    const openDoc = async (i) => {
      if (!docs.has(i)) {
        const fl = files[i];
        if (!fl) throw new EngineError('missing', 'Falta un archivo del expediente.');
        try {
          docs.set(i, await loadDoc(PDFLib, await fl.read(), qpdf));
        } catch (err) {
          if (err && err.code === 'password') throw new EngineError('password', `"${fl.name}" tiene contraseña. Quítasela primero con "Desbloquear PDF".`);
          if (err && err.code === 'damaged') throw new EngineError('damaged', `No pudimos leer "${fl.name}". Puede estar dañado.`);
          throw err;
        }
      }
      return docs.get(i);
    };
    const release = (i) => {
      const n = uses.get(i) - 1;
      uses.set(i, n);
      if (n <= 0) docs.delete(i);
    };

    // Si la página ya sabe qué hojas usar no hace falta abrir nada todavía: así nunca están
    // todos los PDF pesados en memoria a la vez.
    report(0.02, 'Revisando los documentos…', true);
    for (const p of parts) {
      if (p.pages && p.pages.length) p.list = p.pages.map(Number);
      else {
        const total = (await openDoc(p.file)).getPageCount();
        p.list = Array.from({ length: total }, (_, k) => k + 1);
      }
      p.sheets = p.list.length + (p.kind === 'anexo' && job.separators ? 1 : 0);
    }

    // 2) Hojas del frente: carátula + índice (el índice se mide para saber cuántas hojas ocupa).
    const coverOn = Boolean(job.cover && job.cover.enabled);
    const indexOn = Boolean(job.index && job.index.enabled) && anexos.length > 0;
    const rows = [];
    if (job.main) rows.push({ label: 'ESCRITO', desc: (job.cover && job.cover.title) || 'Escrito principal', purpose: '', part: parts[0] });
    parts.filter((p) => p.kind === 'anexo').forEach((p) => rows.push({ label: p.label, desc: p.title || files[p.file].name, purpose: p.purpose, part: p }));
    const measured = indexOn ? measureRows(rows, f) : [];
    const indexPages = indexOn ? paginateRows(measured) : [];
    const front = (coverOn ? 1 : 0) + indexPages.length;

    // 3) Numeración: posición de cada hoja → número de folio.
    const fol = job.folio || {};
    const folioOn = fol.enabled !== false;
    const includeFront = fol.includeFront !== false;
    const start = Math.max(1, Math.floor(Number(fol.start) || 1));
    const totalSheets = front + parts.reduce((s, p) => s + p.sheets, 0);
    const numbered = includeFront ? totalSheets : totalSheets - front;
    const firstNumbered = includeFront ? 0 : front;
    const digits = Math.max(3, String(start + numbered - 1).length);
    const folioAt = (pos) => {
      if (pos < firstNumbered) return null;
      const k = pos - firstNumbered;
      return fol.order === 'desc' ? start + (numbered - 1 - k) : start + k;
    };
    const range = (from, count) => {
      const nums = [folioAt(from), folioAt(from + count - 1)].filter((n) => n != null);
      if (!nums.length) return '';
      const [a, b] = [Math.min(...nums), Math.max(...nums)];
      return a === b ? pad(a, digits) : `${pad(a, digits)} – ${pad(b, digits)}`;
    };
    let pos = front;
    for (const p of parts) { p.start = pos; pos += p.sheets; p.folios = folioOn ? range(p.start, p.sheets) : ''; }
    for (const r of measured) r.folios = r.part.folios;

    // 4) Carátula e índice.
    if (coverOn) {
      const summary = [];
      if (job.main) summary.push(`Escrito principal: ${parts[0].list.length} ${parts[0].list.length === 1 ? 'hoja' : 'hojas'}${parts[0].folios ? ` (folios ${parts[0].folios})` : ''}`);
      if (anexos.length) {
        const pa = parts.filter((p) => p.kind === 'anexo');
        const sheets = pa.reduce((s, p) => s + p.sheets, 0);
        const fr = folioOn ? range(pa[0].start, sheets) : '';
        summary.push(`Anexos: ${anexos.length} (${pa[0].label} a ${pa[pa.length - 1].label}), ${sheets} hojas${fr ? ` (folios ${fr})` : ''}`);
      }
      summary.push(`Total: ${totalSheets} hojas${folioOn ? `, foliadas del ${pad(folioAt(firstNumbered), digits)} al ${pad(folioAt(totalSheets - 1), digits)}` : ''}`);
      drawCover(PDFLib, out.addPage(A4), f, job.cover, summary);
    }
    indexPages.forEach((pageRows, i) => {
      drawIndexPage(PDFLib, out.addPage(A4), pageRows, f, {
        first: i === 0,
        title: (job.index && job.index.title) || 'ÍNDICE DE ANEXOS',
        subtitle: [job.cover && job.cover.caseNumber ? `Expediente N.° ${job.cover.caseNumber}` : '', job.cover && job.cover.title].filter(Boolean).join(' · '),
      });
    });

    // 5) Escrito y anexos (copiando las páginas y liberando cada archivo al terminar de usarlo).
    const totalCopy = parts.reduce((s, p) => s + p.list.length, 0);
    let copied = 0;
    for (const p of parts) {
      const d = await openDoc(p.file);
      const total = d.getPageCount();
      const bad = p.list.find((n) => !Number.isInteger(n) || n < 1 || n > total);
      if (bad != null) throw new EngineError('range', `"${files[p.file].name}" tiene ${total} páginas: la página ${bad} no existe.`);
      if (p.kind === 'anexo' && job.separators) drawSeparator(PDFLib, out.addPage(A4), f, p, p.folios);
      const BATCH = 20;
      for (let b = 0; b < p.list.length; b += BATCH) {
        const nums = p.list.slice(b, b + BATCH);
        const pages = await out.copyPages(d, nums.map((n) => n - 1));
        pages.forEach((pg, k) => {
          out.addPage(pg);
          const marks = p.highlights && p.highlights[nums[k]];
          if (marks && marks.length) drawHighlights(PDFLib, pg, marks);
          if (p.kind === 'anexo' && job.stampLabels !== false && b + k === 0) {
            const vb = visualBox(pg);
            const label = safe(f.bold, p.label);
            const w = f.bold.widthOfTextAtSize(label, 10) + 16;
            drawStamp(PDFLib, pg, vb, { x: 16, y: vb.height - 16 - 22, w, h: 22, text: label, font: f.bold, size: 10, color: COLORS.label, border: 1.2 });
          }
        });
        copied += nums.length;
        report(0.05 + (copied / totalCopy) * 0.75, `Armando ${p.kind === 'main' ? 'el escrito principal' : p.label}: hoja ${Math.min(b + BATCH, p.list.length)} de ${p.list.length}…`);
      }
      release(p.file);
    }

    // 6) Foliación: "FOLIO: 001" arriba a la derecha de cada hoja, con borde rojo.
    const all = out.getPages();
    if (folioOn) {
      const prefix = safe(f.bold, (fol.prefix || 'FOLIO').toUpperCase());
      all.forEach((pg, i) => {
        const n = folioAt(i);
        if (n == null) return;
        const vb = visualBox(pg);
        const text = `${prefix}: ${pad(n, digits)}`;
        const size = 10.5;
        const w = f.bold.widthOfTextAtSize(text, size) + 20;
        const h = 24;
        drawStamp(PDFLib, pg, vb, { x: vb.width - 16 - w, y: vb.height - 16 - h, w, h, text, font: f.bold, size, color: COLORS.red, border: 1.4, double: true });
        if (i % 25 === 0) report(0.82 + (i / all.length) * 0.08, `Foliando hoja ${i + 1} de ${all.length}…`);
      });
    }

    // Vista previa del plan gratis: marca de agua en diagonal.
    if (job.preview) {
      const text = 'VISTA PREVIA - DocuMaus Legal';
      for (const pg of all) {
        const vb = visualBox(pg);
        const size = Math.min(42, (Math.hypot(vb.width, vb.height) * 0.75) / f.bold.widthOfTextAtSize(text, 1));
        const angle = Math.atan2(vb.height, vb.width);
        const tw = f.bold.widthOfTextAtSize(text, size);
        const vx = vb.width / 2 - (tw / 2) * Math.cos(angle) + size * 0.35 * Math.sin(angle);
        const vy = vb.height / 2 - (tw / 2) * Math.sin(angle) - size * 0.35 * Math.cos(angle);
        const p0 = visualToPdf(vb, vx, vy);
        pg.drawText(text, { x: p0.x, y: p0.y, size, font: f.bold, color: rgb(0.85, 0.1, 0.1), opacity: 0.22, rotate: degrees(vb.rot + (angle * 180) / Math.PI) });
      }
    }

    const title = (job.cover && job.cover.title) || 'Expediente';
    out.setTitle(title);
    out.setSubject(`Expediente con ${anexos.length} anexos y ${all.length} folios`);
    out.setCreator('DocuMaus');
    out.setProducer('DocuMaus');
    report(0.92, 'Guardando el expediente…', true);
    let bytes = await out.save({ objectsPerTick: 200 });

    // Bloqueo de edición (permisos del PDF): se puede abrir e imprimir, no modificar.
    if (job.lock && qpdf) {
      report(0.96, 'Bloqueando la edición…', true);
      const owner = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
      const { code, read } = await qpdf(['--encrypt', '', owner, '256', '--modify=none', '--', '/in.pdf', '/out.pdf'], { '/in.pdf': bytes });
      const locked = read('/out.pdf');
      if (code !== 2 && locked) bytes = locked;
    }
    report(1, null, true);
    return {
      bytes,
      sheets: all.length,
      anexos: parts.filter((p) => p.kind === 'anexo').map((p) => ({ label: p.label, folios: p.folios, sheets: p.sheets })),
      main: job.main ? { folios: parts[0].folios, sheets: parts[0].sheets } : null,
    };
  }

  Object.assign(core, { expediente, anexoLabel });
})(typeof self !== 'undefined' ? self : globalThis);
