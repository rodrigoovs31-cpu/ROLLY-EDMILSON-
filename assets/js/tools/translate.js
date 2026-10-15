// Traducir PDF con la IA integrada del navegador (Translator API de Chrome, dentro del equipo).
// Si el navegador no la tiene, ofrece abrir el traductor de documentos de Google.
import { baseName, UserError } from '../lib.js';
import { h, field, iconEl } from '../ui.js';
import { readLayout, requireText } from '../text-layout.js';
import { buildDocx } from '../docx-build.js';

const LANGS = [
  ['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['fr', 'Francés'], ['de', 'Alemán'],
  ['it', 'Italiano'], ['zh', 'Chino'], ['ja', 'Japonés'], ['ko', 'Coreano'], ['ru', 'Ruso'], ['ar', 'Árabe'],
];

let layoutPromise;
let sourceLang = 'es';

let support = 'unavailable';
async function pairSupport(source, target) {
  if (!('Translator' in self) || source === target) return 'unavailable';
  try { return await self.Translator.availability({ sourceLanguage: source, targetLanguage: target }); } catch { return 'unavailable'; }
}
const hasTranslator = () => support !== 'unavailable';

async function detectSource(text) {
  if ('LanguageDetector' in self) {
    try {
      const detector = await self.LanguageDetector.create();
      const [best] = await detector.detect(text.slice(0, 4000));
      if (best?.detectedLanguage && best.detectedLanguage !== 'und') return best.detectedLanguage.split('-')[0];
    } catch { /* usa la heurística */ }
  }
  const words = text.slice(0, 20000).toLowerCase().match(/[a-záéíóúñãõç]+/g) || [];
  const count = (list) => words.filter((w) => list.includes(w)).length;
  const scores = {
    es: count(['el', 'los', 'del', 'las', 'y', 'es', 'por', 'una', 'para', 'con']),
    en: count(['the', 'and', 'of', 'is', 'to', 'that', 'with', 'for', 'this']),
    pt: count(['não', 'em', 'um', 'uma', 'do', 'da', 'são', 'é', 'os', 'ao']),
    fr: count(['le', 'les', 'des', 'et', 'est', 'une', 'pour', 'dans', 'que']),
  };
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
}

export default {
  accept: 'pdf',
  multiple: false,
  view: 'files',
  actionLabel: 'Traducir PDF',
  busyLabel: 'Preparando la traducción…',

  async options(ctx, el) {
    ctx.opts = { target: 'en' };
    layoutPromise = readLayout(ctx.files[0].file);
    const layout = await layoutPromise.catch(() => null);
    const text = layout ? layout.pages.flatMap((p) => p.paragraphs.map((x) => x.text)).join('\n') : '';
    sourceLang = text ? await detectSource(text) : 'es';
    ctx.opts.target = sourceLang === 'es' ? 'en' : 'es';
    const name = (code) => LANGS.find(([c]) => c === code)?.[1] || code;

    const gLink = h('a.btn.btn-ghost.btn-block#tr-google', { target: '_blank', rel: 'noopener' }, iconEl('languages'), 'Abrir el traductor de Google');
    const note = h('div');
    const refresh = async () => {
      gLink.href = `https://translate.google.com/?sl=auto&tl=${ctx.opts.target}&op=docs`;
      support = await pairSupport(sourceLang, ctx.opts.target);
      ctx.setRunEnabled(hasTranslator(), 'Tu navegador no puede traducir este documento');
      note.replaceChildren(hasTranslator()
        ? h('p.side-note.ai-note', {}, iconEl('sparkles'), h('span', {}, `La traducción la hace la IA de Chrome dentro de tu equipo${support === 'available' ? '' : '. La primera vez descarga el idioma (unos minutos)'}.`))
        : h('p.side-note', {}, 'La traducción gratis y privada funciona en Google Chrome de computadora (Windows, Mac o Linux). Aquí puedes usar el traductor de documentos de Google: sube ahí el mismo PDF.'));
    };
    const select = h('select.input#tr-target', { onchange: (e) => { ctx.opts.target = e.target.value; refresh(); } },
      LANGS.map(([code, label]) => h('option', { value: code, selected: code === ctx.opts.target }, label)));

    el.append(
      h('p.field-status', {}, layout?.words ? `Idioma detectado: ${name(sourceLang)}` : 'No encontramos texto en este PDF.'),
      field('Traducir a', select),
      note,
      gLink,
    );
    await refresh();
  },

  validate(ctx) {
    if (!hasTranslator()) return 'Tu navegador no tiene traductor integrado. Usa Chrome en computadora o el botón del traductor de Google.';
    if (ctx.opts.target === sourceLang) return 'Elige un idioma distinto al del documento.';
    return null;
  },

  async run(ctx) {
    // Se crea el traductor de inmediato para no perder el permiso del clic (necesario para descargar el idioma).
    let translator;
    try {
      translator = await self.Translator.create({
        sourceLanguage: sourceLang,
        targetLanguage: ctx.opts.target,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => ctx.progress(e.loaded * 0.2, `Descargando el idioma: ${Math.round(e.loaded * 100)}%`));
        },
      });
    } catch {
      throw new UserError('Chrome no puede traducir este par de idiomas todavía. Prueba con otro idioma o usa el traductor de Google.');
    }
    const layout = await layoutPromise;
    requireText(layout);
    const total = layout.pages.reduce((n, p) => n + p.paragraphs.length, 0);
    let done = 0;
    const pages = [];
    try {
      for (const page of layout.pages) {
        const paragraphs = [];
        for (const p of page.paragraphs) {
          ctx.progress(0.2 + (done / total) * 0.75, `Traduciendo párrafo ${done + 1} de ${total}…`);
          let text = p.text;
          try { text = await translator.translate(p.text); } catch { /* deja el original */ }
          paragraphs.push({ ...p, text });
          done++;
        }
        pages.push({ paragraphs });
      }
    } finally {
      translator.destroy?.();
    }
    const blob = await buildDocx(pages, { title: baseName(ctx.files[0].name) });
    const preview = pages.flatMap((p) => p.paragraphs).slice(0, 6);
    return {
      title: 'Tu traducción está lista',
      summary: `Traducimos ${total} párrafos. Recibes un Word editable.`,
      details: h('div.summary-box', {}, h('ul.summary-points', {}, preview.map((p) => h('li', {}, p.text)))),
      files: [{ name: `${baseName(ctx.files[0].name)}-${ctx.opts.target}.docx`, blob }],
    };
  },
};
