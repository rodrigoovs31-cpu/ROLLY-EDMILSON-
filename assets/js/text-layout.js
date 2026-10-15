// Lee el texto de un PDF con su posición y lo organiza en líneas, párrafos y títulos.
// Lo usan PDF a Word, PDF a Markdown, Traducir PDF y PDF a Excel.
import { readBytes, openPdfjs, yieldUI, UserError } from './lib.js';

const BULLET = /^\s*(?:[•●▪■◦·\-–*]|\(?\d{1,3}[.)]|[a-z][.)])\s+/i;

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// Agrupa los fragmentos de texto de una página en líneas.
function toLines(items) {
  const frags = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
      return { str: it.str, x: e, y: f, w: it.width, size, upright: Math.abs(b) < 0.01 && Math.abs(c) < 0.01 };
    })
    .sort((p, q) => q.y - p.y || p.x - q.x);

  const lines = [];
  for (const fr of frags) {
    const line = lines.find((l) => Math.abs(l.y - fr.y) < Math.max(l.size, fr.size) * 0.45);
    if (line) {
      line.items.push(fr);
      line.size = Math.max(line.size, fr.size);
    } else lines.push({ y: fr.y, size: fr.size, items: [fr] });
  }
  for (const line of lines) {
    line.items.sort((p, q) => p.x - q.x);
    let text = '';
    let prevEnd = null;
    for (const it of line.items) {
      if (prevEnd != null) {
        const gap = it.x - prevEnd;
        if (gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += gap > it.size * 2.5 ? '\t' : ' ';
      }
      text += it.str;
      prevEnd = it.x + it.w;
    }
    line.text = text.replace(/ {2,}/g, ' ').trim();
    line.x0 = line.items[0].x;
    line.x1 = prevEnd;
  }
  return lines.filter((l) => l.text).sort((p, q) => q.y - p.y);
}

// Une líneas en párrafos y detecta títulos y viñetas.
function toParagraphs(lines, bodySize, level) {
  const out = [];
  let cur = null;
  const kindOf = (l) => {
    if (l.size >= bodySize * 1.12 && l.text.length < 160) return level(l.size) || 'h3';
    if (BULLET.test(l.text)) return 'li';
    return 'p';
  };
  for (const [i, line] of lines.entries()) {
    const kind = kindOf(line);
    const prev = lines[i - 1];
    const gap = prev ? prev.y - line.y : 0;
    const close = cur && prev && gap > 0 && gap < Math.max(line.size, prev.size) * 1.75
      && Math.abs(line.size - cur.size) < cur.size * 0.12;
    // Una línea con sangría después de un punto final empieza un párrafo nuevo.
    const indented = /[.:!?]$/.test(prev?.text || '') && line.x0 > (cur?.x0 ?? 0) + line.size * 0.8;
    const sameBlock = close && (
      (kind === cur.kind && kind !== 'li' && !indented)
      || (cur.kind === 'li' && kind === 'p' && line.x0 > cur.x0 + 2)
    );
    if (sameBlock) {
      cur.text = /[-–]$/.test(cur.text) && /^[a-záéíóúñ]/.test(line.text) ? cur.text.slice(0, -1) + line.text : `${cur.text} ${line.text}`;
      cur.lines.push(line);
    } else {
      cur = { kind, text: line.text, size: line.size, x0: line.x0, lines: [line] };
      out.push(cur);
    }
  }
  for (const p of out) {
    if (p.kind === 'li') p.text = p.text.replace(BULLET, '');
    p.text = p.text.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return out.filter((p) => p.text);
}

/**
 * Devuelve { pages: [{ width, height, lines, paragraphs }], bodySize, words }.
 */
export async function readLayout(file, progress = () => {}) {
  const doc = await openPdfjs(await readBytes(file));
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      progress(i / doc.numPages, `Leyendo página ${i} de ${doc.numPages}…`);
      const page = await doc.getPage(i);
      const view = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ width: view.width, height: view.height, lines: toLines(content.items) });
      page.cleanup();
      if (i % 10 === 0) await yieldUI();
    }
  } finally {
    doc.destroy();
  }
  // Quita encabezados y pies de página que se repiten (por ejemplo "Informe - Página 3").
  if (pages.length >= 2) {
    const key = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const seen = new Map();
    for (const p of pages) for (const k of new Set(p.lines.map((l) => key(l.text)))) seen.set(k, (seen.get(k) || 0) + 1);
    const limit = Math.max(2, Math.ceil(pages.length * 0.5));
    for (const p of pages) {
      p.lines = p.lines.filter((l, i) => !((i < 2 || i >= p.lines.length - 2) && seen.get(key(l.text)) >= limit && l.text.length < 120));
    }
  }
  const allLines = pages.flatMap((p) => p.lines);
  const weighted = allLines.flatMap((l) => Array(Math.min(20, Math.ceil(l.text.length / 20))).fill(Math.round(l.size * 2) / 2));
  const bodySize = median(weighted) || 11;
  // El título más grande del documento es h1, el siguiente h2, y el resto h3.
  const headingSizes = [...new Set(allLines.filter((l) => l.size >= bodySize * 1.12 && l.text.length < 160).map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const level = (size) => {
    const i = headingSizes.indexOf(Math.round(size * 2) / 2);
    return i < 0 ? null : ['h1', 'h2', 'h3'][Math.min(i, 2)];
  };
  for (const p of pages) p.paragraphs = toParagraphs(p.lines, bodySize, level);
  const words = allLines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  return { pages, bodySize, words };
}

export function requireText(layout) {
  if (layout.words < 5) {
    throw new UserError('Este PDF no tiene texto seleccionable (parece escaneado). Primero usa "OCR PDF" para reconocer el texto.');
  }
}
