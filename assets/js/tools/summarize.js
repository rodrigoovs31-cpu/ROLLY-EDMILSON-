// Resumir PDF sin servidor y sin costo:
// 1) Si el navegador trae IA integrada (Chrome de computadora con Gemini Nano), la usa.
// 2) Si no, un resumen extractivo (TextRank) elige las frases más importantes del documento.
import { readBytes, openPdfjs, baseName, UserError, yieldUI } from '../lib.js';
import { h, field, segmented, iconEl, toast } from '../ui.js';

const STOP = new Set(`
a al algo algun alguna algunas alguno algunos ante antes aqui asi aun aunque bajo bien cada casi como con contra cual cuales cuando de del desde donde dos el ella ellas ello ellos en entre era eran es esa esas ese eso esos esta estaba estado estan estar estas este esto estos fue fueron fuera ha habia han hasta hay la las le les lo los mas me mi mis mucho muy nada ni no nos nosotros o otra otras otro otros para pero poco por porque puede pueden que quien se sea segun ser si sido sin sobre solo son su sus tambien tan tanto te tiene tienen todo todos tras tu tus un una unas uno unos usted ya yo cuyo cuya dicho dicha mismo misma dentro durante mediante tal tales
the and of to in is that for with as are was were be been by on at this these those from or an it its their they them which who whom have has had not but can will would should may also than then there here into such other more most any all each both very our your we you he she his her
nao em um uma os as do da dos das no na nos nas ao aos pelo pela sao com mais como ou foi ser
`.trim().split(/\s+/));

const LENGTHS = {
  short: { ai: 'short', pct: 0.05, min: 3, max: 5 },
  medium: { ai: 'medium', pct: 0.1, min: 5, max: 10 },
  long: { ai: 'long', pct: 0.18, min: 8, max: 18 },
};
const AI_LANGS = ['es', 'en', 'fr', 'de', 'ja'];
const ABBR = /(?:^|[\s(])(?:sr|sra|srta|dr|dra|lic|ing|arq|prof|etc|art|arts|inc|num|nro|nº|n°|pag|pags|cap|fig|vol|ej|aprox|av|ud|uds|vs|mr|mrs|ms|st|jr|ee|uu|[a-záéíóúñ])\.$/i;

const norm = (w) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const stem = (w) => (w.length > 6 ? w.slice(0, 6) : w);

/* ---------- Texto del PDF ---------- */

async function extractPages(entry, progress) {
  const doc = await openPdfjs(await readBytes(entry.file));
  const pages = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      progress(i / doc.numPages * 0.5, `Leyendo página ${i} de ${doc.numPages}…`);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join(''));
      page.cleanup();
      if (i % 20 === 0) await yieldUI();
    }
  } finally {
    doc.destroy();
  }
  return pages;
}

// Une líneas en oraciones, quita encabezados/pies repetidos y separa títulos sueltos.
function toSentences(pages) {
  const key = (l) => norm(l).replace(/\d+/g, '#').trim();
  const seen = new Map();
  const pageLines = pages.map((p) => p.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean));
  for (const lines of pageLines) for (const k of new Set(lines.map(key))) seen.set(k, (seen.get(k) || 0) + 1);
  const repeated = (l) => pages.length >= 3 && seen.get(key(l)) >= Math.max(3, pages.length * 0.5);

  const blocks = [];
  let cur = '';
  const flush = () => { if (cur.trim()) blocks.push(cur.trim()); cur = ''; };
  for (const lines of pageLines) {
    for (const [i, line] of lines.entries()) {
      if (repeated(line) || /^\d+$/.test(line)) continue;
      const words = line.split(' ').length;
      const next = lines[i + 1] || '';
      const heading = words <= 10 && !/[.,;:!?…]$/.test(line) && (/^[A-ZÁÉÍÓÚÑ¿¡"«“(\d]/.test(next) || line === line.toUpperCase());
      if (heading && !/[-–]$/.test(line)) { flush(); continue; }
      if (/[A-Za-zÁ-ú]-$/.test(cur)) cur = cur.slice(0, -1) + line;
      else cur += (cur ? ' ' : '') + line;
    }
  }
  flush();

  const sentences = [];
  const boundary = /([.!?…]+["»”')\]]*)\s+(?=[¿¡"«“(\[]?[A-ZÁÉÍÓÚÑÜ0-9])/g;
  for (const block of blocks) {
    let start = 0;
    for (const m of block.matchAll(boundary)) {
      const end = m.index + m[1].length;
      const piece = block.slice(start, end);
      if (ABBR.test(piece)) continue;
      sentences.push(piece.trim());
      start = end;
    }
    const rest = block.slice(start).trim();
    if (rest) sentences.push(rest);
  }
  return sentences;
}

function detectLang(text) {
  const words = text.slice(0, 20000).toLowerCase().match(/[a-záéíóúñãõç]+/g) || [];
  const count = (list) => words.filter((w) => list.includes(w)).length;
  const es = count(['el', 'los', 'del', 'las', 'y', 'es', 'por', 'una', 'para', 'con']);
  const en = count(['the', 'and', 'of', 'is', 'to', 'that', 'with', 'for', 'this']);
  const pt = count(['não', 'em', 'um', 'uma', 'do', 'da', 'são', 'é', 'os', 'ao']);
  const best = Math.max(es, en, pt);
  return best === en ? 'en' : best === pt && pt > es ? 'pt' : 'es';
}

/* ---------- Resumen extractivo (TextRank) ---------- */

function extractive(sentences, lengthKey) {
  const cfg = LENGTHS[lengthKey];
  let items = sentences.map((text, i) => {
    const toks = (text.match(/[\p{L}]+/gu) || []).map(norm).filter((w) => w.length >= 3 && !STOP.has(w)).map(stem);
    return { i, text, words: text.split(/\s+/).length, terms: new Set(toks), toks };
  }).filter((s) => s.words >= 6 && s.words <= 70 && s.terms.size >= 3);
  if (!items.length) return { points: [], keywords: [] };

  // Frecuencia de términos en todo el documento
  const tf = new Map();
  for (const s of items) for (const t of s.toks) tf.set(t, (tf.get(t) || 0) + 1);

  if (items.length > 700) {
    items = items
      .map((s) => ({ s, score: [...s.terms].reduce((a, t) => a + tf.get(t), 0) / Math.sqrt(s.terms.size) }))
      .sort((a, b) => b.score - a.score).slice(0, 700).map((x) => x.s)
      .sort((a, b) => a.i - b.i);
  }

  const n = items.length;
  const sim = Array.from({ length: n }, () => new Float32Array(n));
  const outSum = new Float32Array(n);
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      let common = 0;
      const [small, big] = items[a].terms.size < items[b].terms.size ? [items[a].terms, items[b].terms] : [items[b].terms, items[a].terms];
      for (const t of small) if (big.has(t)) common++;
      if (!common) continue;
      const w = common / (Math.log(items[a].terms.size + 1) + Math.log(items[b].terms.size + 1));
      sim[a][b] = sim[b][a] = w;
      outSum[a] += w;
      outSum[b] += w;
    }
  }
  let rank = new Float32Array(n).fill(1);
  for (let iter = 0; iter < 40; iter++) {
    const next = new Float32Array(n).fill(0.15);
    for (let a = 0; a < n; a++) {
      if (!outSum[a]) continue;
      const share = 0.85 * rank[a] / outSum[a];
      const row = sim[a];
      for (let b = 0; b < n; b++) if (row[b]) next[b] += share * row[b];
    }
    rank = next;
  }

  const firstIndex = items[0].i;
  const span = Math.max(1, items[n - 1].i - firstIndex);
  const scored = items.map((s, k) => ({ s, score: rank[k] * (1 + 0.15 * (1 - (s.i - firstIndex) / span)) }))
    .sort((a, b) => b.score - a.score);

  const want = Math.min(cfg.max, Math.max(cfg.min, Math.round(n * cfg.pct)));
  const chosen = [];
  for (const { s } of scored) {
    if (chosen.length >= want) break;
    const redundant = chosen.some((c) => {
      let common = 0;
      for (const t of s.terms) if (c.terms.has(t)) common++;
      return common / (s.terms.size + c.terms.size - common) > 0.5;
    });
    if (!redundant) chosen.push(s);
  }
  chosen.sort((a, b) => a.i - b.i);

  // Palabras clave: términos más frecuentes, mostrados con su forma original más común
  const forms = new Map();
  for (const s of items) {
    for (const raw of s.text.match(/[\p{L}]+/gu) || []) {
      const w = norm(raw);
      if (w.length < 4 || STOP.has(w)) continue;
      const st = stem(w);
      const m = forms.get(st) || new Map();
      const f = raw.toLowerCase();
      m.set(f, (m.get(f) || 0) + 1);
      forms.set(st, m);
    }
  }
  const keywords = [...tf.entries()]
    .filter(([t]) => forms.has(t) && t.length >= 4)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([t]) => [...forms.get(t).entries()].sort((a, b) => b[1] - a[1])[0][0]);

  return { points: chosen.map((s) => s.text), keywords };
}

/* ---------- IA integrada del navegador ---------- */

const aiOptions = (lang, lengthKey) => ({
  type: 'key-points', format: 'plain-text', length: LENGTHS[lengthKey].ai,
  expectedInputLanguages: [lang], outputLanguage: lang,
});

async function aiAvailability(lang) {
  if (!('Summarizer' in self) || !AI_LANGS.includes(lang)) return 'unavailable';
  try { return await self.Summarizer.availability(aiOptions(lang, 'medium')); } catch { return 'unavailable'; }
}

async function aiSummarize(text, lang, lengthKey, progress) {
  const summarizer = await self.Summarizer.create({
    ...aiOptions(lang, lengthKey),
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => progress(0.5 + e.loaded * 0.3, `Descargando la IA de Chrome (solo la primera vez): ${Math.round(e.loaded * 100)}%`));
    },
  });
  try {
    progress(0.85, 'La IA está resumiendo…');
    const out = await summarizer.summarize(text);
    return out.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  } finally {
    summarizer.destroy?.();
  }
}

/* ---------- Herramienta ---------- */

let aiState = 'unavailable';

export default {
  accept: 'pdf',
  multiple: false,
  view: 'files',
  actionLabel: 'Resumir PDF',
  busyLabel: 'Leyendo tu PDF…',

  async options(ctx, el) {
    ctx.opts = { length: 'medium', useAi: false };
    aiState = await aiAvailability('es');
    el.append(field('Largo del resumen', segmented('sum-length', [
      { value: 'short', label: 'Corto' }, { value: 'medium', label: 'Medio' }, { value: 'long', label: 'Largo' },
    ], 'medium', (v) => { ctx.opts.length = v; })));

    if (aiState === 'available') {
      ctx.opts.useAi = true;
      el.append(h('p.side-note.ai-note', {}, iconEl('sparkles'), h('span', {}, 'Tu navegador tiene IA integrada. El resumen se hará con ella, dentro de tu equipo.')));
    } else if (aiState === 'downloadable' || aiState === 'downloading') {
      el.append(h('label.check', {},
        h('input#sum-ai', { type: 'checkbox', onchange: (e) => { ctx.opts.useAi = e.target.checked; } }),
        'Usar la IA de Chrome (se descarga una sola vez, varios GB)'));
    }
    el.append(h('p.side-note', {}, 'Funciona con PDF que tienen texto. Si tu PDF es escaneado (una foto), primero usa "OCR PDF".'));
  },

  async run(ctx) {
    const entry = ctx.files[0];
    const pages = await extractPages(entry, ctx.progress);
    const fullText = pages.join('\n');
    const totalWords = (fullText.match(/[\p{L}\d]+/gu) || []).length;
    if (totalWords < 40) {
      throw new UserError('Este PDF no tiene texto seleccionable (parece escaneado). Primero usa "OCR PDF".');
    }

    ctx.progress(0.55, 'Buscando las ideas principales…');
    await yieldUI();
    const sentences = toSentences(pages);
    const lang = detectLang(fullText);
    const base = extractive(sentences, ctx.opts.length);
    let points = base.points;
    let method = 'extractive';

    if (ctx.opts.useAi && AI_LANGS.includes(lang)) {
      try {
        // La IA local acepta textos limitados: si el PDF es largo, se le da la selección de frases clave más amplia.
        const text = fullText.length <= 12000 ? fullText : extractive(sentences, 'long').points.join(' ').slice(0, 12000);
        const aiPoints = await aiSummarize(text, lang, ctx.opts.length, ctx.progress);
        if (aiPoints.length) { points = aiPoints; method = 'ai'; }
      } catch (err) {
        console.warn('IA no disponible, se usa el resumen por frases clave.', err);
      }
    }
    if (!points.length) throw new UserError('No encontramos suficientes oraciones para resumir este PDF.');

    const minutes = Math.max(1, Math.round(totalWords / 200));
    const summaryText = [
      `Resumen de: ${entry.name}`,
      '',
      ...points.map((p) => `• ${p}`),
      '',
      base.keywords.length ? `Palabras clave: ${base.keywords.join(', ')}` : '',
    ].join('\n').trim();

    const copy = h('button.btn.btn-ghost.sm', {
      type: 'button',
      onclick: async () => {
        try { await navigator.clipboard.writeText(summaryText); toast('Resumen copiado'); }
        catch { toast('No se pudo copiar. Descarga el archivo de texto.', 'error'); }
      },
    }, iconEl('copy'), 'Copiar resumen');

    const details = h('div.summary-box', {},
      h('div.summary-meta', {},
        h('span.badge' + (method === 'ai' ? '.ok' : ''), {}, method === 'ai' ? 'Hecho con la IA de tu navegador' : 'Frases clave del documento'),
        h('span', {}, `${pages.length} ${pages.length === 1 ? 'página' : 'páginas'} · ${totalWords.toLocaleString('es')} palabras · ${minutes} min de lectura`)),
      h('ul.summary-points', {}, points.map((p) => h('li', {}, p))),
      base.keywords.length ? h('div.summary-keywords', {}, h('strong', {}, 'Palabras clave'),
        h('div.kw-list', {}, base.keywords.map((k) => h('span.kw', {}, k)))) : null,
      copy);

    return {
      title: 'Tu resumen está listo',
      summary: `${points.length} ideas principales de un documento de ${minutes} min de lectura.`,
      details,
      files: [{ name: `${baseName(entry.name)}-resumen.txt`, blob: new Blob([summaryText], { type: 'text/plain;charset=utf-8' }) }],
    };
  },
};

// Para pruebas
export const _internal = { toSentences, extractive, detectLang };
