// Lee el texto de un PDF con su posición y lo ordena en líneas, párrafos y títulos.
// Es la misma lógica que usa la web (assets/js/text-layout.js), adaptada a Node.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { EngineError } from './errors.js';

const require = createRequire(import.meta.url);
const PDFJS_DIR = dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONTS = join(PDFJS_DIR, 'standard_fonts') + '/';
const CMAPS = join(PDFJS_DIR, 'cmaps') + '/';

const BULLET = /^\s*(?:[•●▪■◦·\-–*]|\(?\d{1,3}[.)]|[a-z][.)])\s+/i;

interface Frag { str: string; x: number; y: number; w: number; size: number }
interface Line { y: number; size: number; items: Frag[]; text: string; x0: number; x1: number }
export type Kind = 'h1' | 'h2' | 'h3' | 'p' | 'li';
export interface Paragraph { kind: Kind; text: string; size: number; x0: number }
export interface PageLayout { width: number; height: number; lines: Line[]; paragraphs: Paragraph[] }
export interface Layout { pages: PageLayout[]; bodySize: number; words: number }

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function toLines(items: Array<{ str: string; transform: number[]; width: number }>): Line[] {
  const frags: Frag[] = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => {
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = it.transform;
      const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
      return { str: it.str, x: e, y: f, w: it.width, size };
    })
    .sort((p, q) => q.y - p.y || p.x - q.x);

  const lines: Line[] = [];
  for (const fr of frags) {
    const line = lines.find((l) => Math.abs(l.y - fr.y) < Math.max(l.size, fr.size) * 0.45);
    if (line) {
      line.items.push(fr);
      line.size = Math.max(line.size, fr.size);
    } else lines.push({ y: fr.y, size: fr.size, items: [fr], text: '', x0: 0, x1: 0 });
  }
  for (const line of lines) {
    line.items.sort((p, q) => p.x - q.x);
    let text = '';
    let prevEnd: number | null = null;
    for (const it of line.items) {
      if (prevEnd != null) {
        const gap = it.x - prevEnd;
        if (gap > it.size * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += gap > it.size * 2.5 ? '\t' : ' ';
      }
      text += it.str;
      prevEnd = it.x + it.w;
    }
    line.text = text.replace(/ {2,}/g, ' ').trim();
    line.x0 = line.items[0]!.x;
    line.x1 = prevEnd ?? line.x0;
  }
  return lines.filter((l) => l.text).sort((p, q) => q.y - p.y);
}

function toParagraphs(lines: Line[], bodySize: number, level: (size: number) => Kind | null): Paragraph[] {
  const out: Array<Paragraph & { lines: Line[] }> = [];
  let cur: (Paragraph & { lines: Line[] }) | null = null;
  const kindOf = (l: Line): Kind => {
    if (l.size >= bodySize * 1.12 && l.text.length < 160) return level(l.size) ?? 'h3';
    if (BULLET.test(l.text)) return 'li';
    return 'p';
  };
  lines.forEach((line, i) => {
    const kind = kindOf(line);
    const prev = lines[i - 1];
    const gap = prev ? prev.y - line.y : 0;
    const close = !!cur && !!prev && gap > 0 && gap < Math.max(line.size, prev.size) * 1.75
      && Math.abs(line.size - cur.size) < cur.size * 0.12;
    const indented = /[.:!?]$/.test(prev?.text ?? '') && line.x0 > (cur?.x0 ?? 0) + line.size * 0.8;
    const sameBlock = close && cur && (
      (kind === cur.kind && kind !== 'li' && !indented)
      || (cur.kind === 'li' && kind === 'p' && line.x0 > cur.x0 + 2)
    );
    if (sameBlock && cur) {
      cur.text = /[-–]$/.test(cur.text) && /^[a-záéíóúñ]/.test(line.text) ? cur.text.slice(0, -1) + line.text : `${cur.text} ${line.text}`;
      cur.lines.push(line);
    } else {
      cur = { kind, text: line.text, size: line.size, x0: line.x0, lines: [line] };
      out.push(cur);
    }
  });
  return out
    .map((p) => ({
      kind: p.kind,
      size: p.size,
      x0: p.x0,
      text: (p.kind === 'li' ? p.text.replace(BULLET, '') : p.text).replace(/\t/g, ' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((p) => p.text);
}

export async function readLayout(bytes: Uint8Array): Promise<Layout> {
  const task = getDocument({
    data: bytes,
    standardFontDataUrl: STANDARD_FONTS,
    cMapUrl: CMAPS,
    cMapPacked: true,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    if ((err as { name?: string })?.name === 'PasswordException') throw new EngineError('password');
    throw new EngineError('damaged');
  }
  const pages: PageLayout[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const view = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.filter((it): it is typeof it & { str: string; transform: number[]; width: number } => 'str' in it);
      pages.push({ width: view.width, height: view.height, lines: toLines(items), paragraphs: [] });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  // Quita encabezados y pies de página repetidos ("Informe - Página 3").
  if (pages.length >= 2) {
    const key = (t: string) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const seen = new Map<string, number>();
    for (const p of pages) for (const k of new Set(p.lines.map((l) => key(l.text)))) seen.set(k, (seen.get(k) ?? 0) + 1);
    const limit = Math.max(2, Math.ceil(pages.length * 0.5));
    for (const p of pages) {
      p.lines = p.lines.filter((l, i) => !((i < 2 || i >= p.lines.length - 2) && (seen.get(key(l.text)) ?? 0) >= limit && l.text.length < 120));
    }
  }
  const allLines = pages.flatMap((p) => p.lines);
  const weighted = allLines.flatMap((l) => Array<number>(Math.min(20, Math.ceil(l.text.length / 20))).fill(Math.round(l.size * 2) / 2));
  const bodySize = median(weighted) || 11;
  const headingSizes = [...new Set(allLines
    .filter((l) => l.size >= bodySize * 1.12 && l.text.length < 160)
    .map((l) => Math.round(l.size * 2) / 2))].sort((a, b) => b - a);
  const level = (size: number): Kind | null => {
    const i = headingSizes.indexOf(Math.round(size * 2) / 2);
    return i < 0 ? null : (['h1', 'h2', 'h3'] as const)[Math.min(i, 2)]!;
  };
  for (const p of pages) p.paragraphs = toParagraphs(p.lines, bodySize, level);
  const words = allLines.reduce((n, l) => n + l.text.split(/\s+/).length, 0);
  return { pages, bodySize, words };
}
