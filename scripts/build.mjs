// Genera todas las páginas HTML de la web a partir de assets/js/tools-data.js y config.js.
// Uso: npm run build   (o: node scripts/build.mjs)
import { writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SITE } from '../assets/js/config.js';
import { TOOLS, CATEGORIES, HOME_ORDER, FLOWS, toolById } from '../assets/js/tools-data.js';
import { icon } from '../assets/js/icons.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VERSION = Date.now().toString(36);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Dominio y API se definen al publicar, nunca fijos en el código:
//   SITE_URL=https://tudominio.com API_BASE=/api npm run build
// Sin SITE_URL, la web usa enlaces relativos (sirve en cualquier hosting) y no emite canónicas.
const SITE_URL = (process.env.SITE_URL || '').trim().replace(/\/+$/, '');
const API_BASE = (process.env.API_BASE || '').trim().replace(/\/+$/, '');
if (SITE_URL && !/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(SITE_URL)) throw new Error(`SITE_URL inválida: "${SITE_URL}". Ejemplo: https://documaus.com`);
if (API_BASE && !/^(\/|https:\/\/)[^\s]*$/.test(API_BASE)) throw new Error(`API_BASE inválida: "${API_BASE}". Ejemplo: /api`);
writeFileSync(`${ROOT}assets/js/env.js`, `// Generado por scripts/build.mjs: no lo edites a mano.
// Para cambiarlo: SITE_URL=https://tudominio.com API_BASE=/api npm run build
export const ENV = ${JSON.stringify({ siteUrl: SITE_URL, apiBase: API_BASE }, null, 2)};
`);
const abs = (path) => (SITE_URL ? `${SITE_URL}/${path}` : path);
const live = TOOLS.filter((t) => t.status === 'ok');

const modules = Object.fromEntries(await Promise.all(live.map(async (t) =>
  [t.id, (await import(`../assets/js/tools/${t.module}.js`)).default])));

const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="lg-body" cx="12" cy="11" r="8.5"/><circle class="lg-accent" cx="12" cy="11" r="4.4"/><circle class="lg-body" cx="36" cy="11" r="8.5"/><circle class="lg-accent" cx="36" cy="11" r="4.4"/><path class="lg-body" d="M15 9h18a7 7 0 0 1 7 7v17L29 44H15a7 7 0 0 1-7-7V16a7 7 0 0 1 7-7Z"/><path class="lg-accent" d="M40 33h-6a5 5 0 0 0-5 5v6Z"/><circle class="lg-eye" cx="18" cy="24" r="2.5"/><circle class="lg-eye" cx="30" cy="24" r="2.5"/><path class="lg-accent" d="M21.6 30.4h4.8L24 33.2Z" stroke="var(--brand)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

// Nombre en el encabezado: "docu" más liviano y "maus" en negrita.
function brandWord() {
  const name = SITE.name.toLowerCase();
  const m = name.match(/^(docu)(.+)$/);
  return m ? `<span class="bn-pre">${esc(m[1])}</span>${esc(m[2])}` : esc(name);
}

function head({ title, desc, path, jsonld }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${SITE_URL ? `<link rel="canonical" href="${esc(abs(path))}">\n` : ''}<meta name="theme-color" content="#FFC21A">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(abs('assets/img/og.png'))}">
<meta property="og:locale" content="es_LA">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<link rel="manifest" href="manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Figtree:wght@400..700&display=swap">
<link rel="stylesheet" href="assets/css/maus.css?v=${VERSION}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n` : ''}</head>`;
}

function header() {
  const cols = CATEGORIES.map((c) => `<div class="mega-col">
          <h3 class="mega-title">${esc(c.name)}</h3>
          <ul>${live.filter((t) => t.cat === c.id).map((t) => `<li><a href="${t.id}.html"><span class="tile sm cat-${t.cat}">${icon(t.icon)}</span>${esc(t.name)}</a></li>`).join('')}</ul>
        </div>`).join('\n        ');
  return `<header class="site-header">
  <div class="wrap">
    <a class="brand" href="index.html" aria-label="${esc(SITE.name)}, inicio">${LOGO}<span class="brand-name">${brandWord()}</span></a>
    <nav class="nav" aria-label="Principal">
      <a class="nav-link-wide" href="unir-pdf.html">Unir PDF</a>
      <a class="nav-link-wide" href="dividir-pdf.html">Dividir PDF</a>
      <a class="nav-link-wide" href="comprimir-pdf.html">Comprimir PDF</a>
      <button class="nav-all" type="button" aria-expanded="false" aria-controls="mega" aria-label="Todas las herramientas"><span class="nav-all-icon">${icon('menu')}</span><span class="nav-all-full">Todas las herramientas</span><span class="nav-all-short">Herramientas</span> ${icon('chevron-down', 'nav-all-chevron')}</button>
      <a class="btn btn-brand sm" href="index.html#planes">Hazte Pro</a>
    </nav>
  </div>
  <div class="mega" id="mega" hidden>
    <div class="wrap">
      <div class="mega-grid">
        ${cols}
      </div>
    </div>
  </div>
</header>`;
}

function footer() {
  const col = (list) => list.map((t) => `<li><a href="${t.id}.html">${esc(t.name)}</a></li>`).join('');
  const byId = (ids) => ids.map((id) => TOOLS.find((t) => t.id === id));
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-about">
        <a class="brand" href="index.html">${LOGO}<span class="brand-name">${brandWord()}</span></a>
        <p>Herramientas PDF gratis, rápidas y privadas. Hechas en español para tus trámites de todos los días.</p>
      </div>
      <div><h4>Herramientas</h4><ul>${col(byId(['unir-pdf', 'dividir-pdf', 'comprimir-pdf', 'editar-pdf', 'firmar-pdf', 'ocr-pdf']))}</ul></div>
      <div><h4>Convertir</h4><ul>${col(byId(['pdf-a-word', 'word-a-pdf', 'pdf-a-excel', 'excel-a-pdf', 'pdf-a-jpg', 'jpg-a-pdf']))}</ul></div>
      <div><h4>${esc(SITE.name)}</h4><ul>
        <li><a href="index.html#planes">Planes</a></li>
        <li><a href="flujos.html">Flujos de trabajo</a></li>
        <li><a href="index.html#preguntas">Preguntas frecuentes</a></li>
        <li><a href="privacidad.html">Privacidad</a></li>
        <li><a href="terminos.html">Términos de uso</a></li>
        <li><a data-wa="Hola, tengo una consulta sobre ${esc(SITE.name)}" hidden>WhatsApp</a></li>
        <li><a data-email hidden></a></li>
        <li><a data-social="facebook" hidden target="_blank" rel="noopener">Facebook</a></li>
        <li><a data-social="instagram" hidden target="_blank" rel="noopener">Instagram</a></li>
        <li><a data-social="tiktok" hidden target="_blank" rel="noopener">TikTok</a></li>
      </ul></div>
    </div>
    <div class="footer-bottom">
      <span>© <span data-year>${new Date().getFullYear()}</span> ${esc(SITE.name)}. Todos los derechos reservados.</span>
      <span>Funciona con software libre: pdf-lib, PDF.js, qpdf y Tesseract.</span>
    </div>
  </div>
</footer>`;
}

function toolCard(t, { small = false } = {}) {
  const tag = t.status === 'ok' ? 'a' : 'div';
  const href = t.status === 'ok' ? ` href="${t.id}.html"` : ' aria-disabled="true"';
  return `<${tag} class="tool-card cat-${t.cat}${t.status === 'ok' ? '' : ' is-soon'}"${href} data-cat="${t.cat}">
      <span class="tile cat-${t.cat}">${icon(t.icon)}</span>
      ${small ? `<h3>${esc(t.name)}</h3>` : `<h3>${esc(t.name)}</h3>\n      <p>${esc(t.short)}</p>`}
      ${t.status === 'ok' ? '' : '<span class="badge">Pronto</span>'}${t.pro ? `<span class="badge plan-badge">${t.plan === 'legal' ? 'Legal' : 'Pro'}</span>` : ''}
    </${tag}>`;
}

function flowCard(f) {
  return `<a class="flow-card" href="${f.steps[0]}.html?flujo=${f.id}&paso=0">
        <span class="flow-head"><span class="tile cat-${toolById(f.steps[0]).cat}">${icon(f.icon)}</span><span class="badge">Pro</span></span>
        <h3>${esc(f.name)}</h3>
        <p>${esc(f.desc)}</p>
        <ol class="flow-steps">${f.steps.map((id) => `<li>${esc(toolById(id).name)}</li>`).join('')}</ol>
      </a>`;
}

function page(parts) {
  return `${parts.head}
<body${parts.bodyAttr || ''}>
${header()}
<main>
${parts.main}
</main>
${footer()}
<script type="module" src="assets/js/site.js?v=${VERSION}"></script>
${parts.scripts || ''}</body>
</html>
`;
}

/* ---------- Portada ---------- */

const FAQ = [
  [`¿${SITE.name} es gratis?`, 'Sí. Todas las herramientas funcionan gratis y sin registrarte. El plan Pro es opcional.'],
  ['¿Mis archivos están seguros?', 'Sí. Tus PDF se procesan dentro de tu navegador y nunca se suben a ningún servidor. Cuando cierras la página, desaparecen.'],
  ['¿Funciona en el celular?', 'Sí, en Android y iPhone, desde Chrome, Safari o cualquier navegador moderno. No necesitas instalar ninguna app.'],
  ['¿Hay un límite de tamaño?', 'No ponemos límites. El único límite es la memoria de tu equipo: en celulares, los PDF de cientos de páginas pueden tardar un poco más.'],
  ['¿Puedo convertir Word, Excel o PowerPoint a PDF?', 'Sí, y también al revés (PDF a Word, Excel y PowerPoint). Todo funciona en tu navegador. Los documentos con diseños muy complejos o fuentes especiales pueden verse un poco distintos.'],
  ['¿Qué es la IA de DocuMaus?', 'Resumir y Traducir PDF usan Gemini Nano, la inteligencia artificial que Google incluye dentro de Chrome en computadora. Funciona en tu equipo, sin enviar tu documento a internet y sin costo. En celulares, Resumir usa un método que elige las frases más importantes.'],
  [`¿Qué diferencia hay entre "Firmar PDF" y "Firma digital"?`, `"Firmar PDF" coloca la imagen de tu firma (firma electrónica simple): sirve para el día a día. "Firma digital" usa tu certificado (.pfx o .p12) y protege el documento: si alguien lo cambia, el lector de PDF lo detecta. ${SITE.name} no emite certificados; si un trámite del Estado exige firmar con el DNI electrónico, usa ReFirma de RENIEC.`],
  [`¿Cómo funciona el código Pro?`, `Pagas por Yape o transferencia, te enviamos un código por WhatsApp y lo pegas en "Ya tengo un código". Se guarda en tu navegador: si cambias de equipo, vuelve a pegarlo.`],
  [`¿Funciona sin internet?`, `Sí. Toca "Usar sin internet" en la portada y ${SITE.name} guarda sus programas en tu equipo. Después puedes unir, dividir, comprimir, firmar y más aunque no tengas conexión.`],
];

const home = page({
  head: head({
    title: `${SITE.name}: ${SITE.tagline}`,
    desc: 'Une, divide, comprime, convierte, firma y protege tus PDF gratis y sin registro. Tus archivos nunca se suben a internet.',
    path: '',
    jsonld: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  }),
  main: `<section class="home-hero wrap" id="herramientas">
  <span class="eyebrow"><span class="dot"></span>Herramientas PDF gratis · en español</span>
  <h1>Todo lo que haces con un PDF, <mark>en un solo lugar</mark>.</h1>
  <p class="lead">Une, divide, comprime, convierte, firma y protege tus documentos. Gratis y sin registrarte. <strong>Tus archivos nunca se suben a ningún servidor: 100% procesado en tu navegador</strong>.</p>
  <div class="filters" role="toolbar" aria-label="Filtrar herramientas">
    <button class="chip" type="button" data-cat="all" aria-pressed="true">Todas</button>
    ${CATEGORIES.map((c) => `<button class="chip" type="button" data-cat="${c.id}" aria-pressed="false">${esc(c.name)}</button>`).join('\n    ')}
  </div>
</section>
<div class="wrap">
  <div class="tools-grid">
    ${HOME_ORDER.map((id) => TOOLS.find((t) => t.id === id)).filter(Boolean).map((t) => toolCard(t)).join('\n    ')}
  </div>
</div>

<section class="section legal-band" id="legal">
  <div class="wrap legal-grid">
    <div>
      <span class="eyebrow">${icon('scale')}${esc(SITE.name)} Legal · para abogados, notarías y licitaciones</span>
      <h2>Arma tu expediente con anexos, índice y foliación en minutos</h2>
      <p>Sube tu escrito y tus medios probatorios. ${esc(SITE.name)} los etiqueta como <strong>ANEXO 1-A, 1-B…</strong>, arma la carátula y el índice con sus folios, resalta lo importante y numera cada hoja con el sello <strong>FOLIO: 001</strong>.</p>
      <ul class="legal-points">
        <li>${icon('list-ordered')}<span>Índice de anexos con número, folios y objeto de prueba</span></li>
        <li>${icon('stamp')}<span>Foliación automática arriba a la derecha, con borde rojo</span></li>
        <li>${icon('highlighter')}<span>Finalidad probatoria y resaltado fluorescente de cláusulas</span></li>
        <li>${icon('shield-check')}<span>Expedientes de cientos de hojas, sin subir nada a internet</span></li>
      </ul>
      <div class="legal-cta">
        <a class="btn btn-brand btn-lg" href="armar-expediente.html">${icon('scale')}Armar un expediente</a>
        <a class="btn btn-ghost btn-lg" href="#planes">Ver plan Legal · desde ${esc(SITE.plans.legal.currency)} ${esc(SITE.plans.legal.price)}/${esc(SITE.plans.legal.period)}</a>
      </div>
    </div>
    <div class="legal-mock" aria-hidden="true">
      <div class="lm-page lm-back"><span class="lm-folio">FOLIO: 014</span><span class="lm-label">ANEXO 1-B</span><span class="lm-line"></span><span class="lm-line hl"></span><span class="lm-line"></span><span class="lm-line short"></span></div>
      <div class="lm-page lm-front"><span class="lm-folio">FOLIO: 002</span><strong class="lm-title">ÍNDICE DE ANEXOS</strong>
        <span class="lm-row"><b>ANEXO 1-A</b><i>Contrato de arrendamiento</i><em>003 – 012</em></span>
        <span class="lm-row"><b>ANEXO 1-B</b><i>Recibos impagos</i><em>013 – 016</em></span>
        <span class="lm-row"><b>ANEXO 1-C</b><i>Carta notarial</i><em>017 – 019</em></span>
      </div>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section-head">
      <h2>Hecho para tus trámites de todos los días</h2>
      <p>Postulaciones, matrículas, contratos, recibos. ${esc(SITE.name)} te deja el documento listo para enviar.</p>
    </div>
    <div class="benefits five">
      <div class="benefit">${icon('shield-check')}<h3>Tus archivos no salen de tu equipo</h3><p>Todo se procesa en tu navegador. Nadie más ve tus documentos, ni siquiera nosotros.</p></div>
      <div class="benefit">${icon('smartphone')}<h3>Funciona en tu celular</h3><p>Firma, comprime o une PDF desde el teléfono, sin instalar ninguna app.</p></div>
      <div class="benefit">${icon('zap')}<h3>Rápido y sin registro</h3><p>Entra, elige tu archivo y descárgalo listo. Sin cuentas y sin esperas.</p></div>
      <div class="benefit">${icon('cloud-off')}<h3>Funciona sin internet</h3><p>Instálala como app en tu celular o computadora y úsala aunque no tengas conexión.</p><button class="btn btn-ghost sm" type="button" data-offline>${icon('download')}<span>Usar sin internet</span></button></div>
      <div class="benefit">${icon('badge-check')}<h3>Sin marcas de agua</h3><p>Tus documentos salen limpios, sin logos ni sellos de ${esc(SITE.name)}.</p></div>
    </div>
  </div>
</section>

<section class="section" id="flujos">
  <div class="wrap">
    <div class="section-head">
      <h2>Flujos de trabajo</h2>
      <p>Varias herramientas seguidas, sin descargar y volver a subir: el resultado de una pasa solo a la siguiente.</p>
    </div>
    <div class="flows">
      ${FLOWS.slice(0, 3).map((f) => flowCard(f)).join('\n      ')}
    </div>
    <p style="margin-top:18px"><a class="btn btn-ghost" href="flujos.html">Ver todos los flujos ${icon('arrow-right')}</a></p>
  </div>
</section>

<section class="section" id="planes">
  <div class="wrap">
    <div class="section-head">
      <h2>Planes</h2>
      <p>Las herramientas del día a día son gratis para siempre. Pro es para quienes trabajan con documentos todos los días, y Legal para abogados, notarías y licitaciones.</p>
    </div>
    <div class="plans four">
      <div class="plan">
        <div class="plan-name">Gratis</div>
        <div class="plan-price">${esc(SITE.currency)} 0 <small>para siempre</small></div>
        <ul>
          <li>${icon('check')}<span>${live.filter((t) => !t.pro).length} herramientas sin registro</span></li>
          <li>${icon('check')}<span>Sin marcas de agua</span></li>
          <li>${icon('check')}<span>Hasta ${SITE.pro.freeLimits.files} archivos a la vez</span></li>
          <li>${icon('check')}<span>OCR de hasta ${SITE.pro.freeLimits.ocrPages} páginas</span></li>
          <li>${icon('check')}<span>Tus archivos nunca salen de tu equipo</span></li>
        </ul>
        <a class="btn btn-ghost btn-lg" href="#herramientas">Usar gratis</a>
      </div>
      <div class="plan pro">
        <div class="plan-name">Pro <span class="badge ok">Más elegido</span></div>
        <div class="plan-price"><span data-price>${esc(SITE.currency)} ${esc(SITE.proPrice)}</span> <small data-period>/ ${esc(SITE.proPeriod)}</small></div>
        <ul>
          <li>${icon('check')}<span>Todo lo del plan Gratis</span></li>
          <li>${icon('check')}<span><strong>Firma digital</strong> con tu certificado (.pfx o .p12)</span></li>
          <li>${icon('check')}<span><strong>Flujos de trabajo</strong>: contratos, escaneos y más</span></li>
          <li>${icon('check')}<span>Archivos y OCR sin límite</span></li>
          <li>${icon('check')}<span>Ayuda prioritaria por WhatsApp</span></li>
        </ul>
        <p class="pay-methods">${icon('sparkles')}<span>Paga con <span data-pay>${esc(SITE.paymentMethods.join(' · '))}</span></span></p>
        <a class="btn btn-brand btn-lg" href="#pro" data-pro-open>${icon('sparkles')}Quiero ${esc(SITE.name)} Pro</a>
        <a class="plan-link" href="#pro" data-pro-open>Ya tengo un código</a>
      </div>
      <div class="plan legal">
        <div class="plan-name">Legal <span class="badge plan-badge">Abogados y licitaciones</span></div>
        <div class="plan-price">${esc(SITE.plans.legal.currency)} ${esc(SITE.plans.legal.price)} <small>/ ${esc(SITE.plans.legal.period)}</small></div>
        <ul>
          <li>${icon('check')}<span>Todo lo del plan Pro</span></li>
          <li>${icon('check')}<span><strong>Armador de expedientes</strong>: carátula, índice y anexos 1-A, 1-B…</span></li>
          <li>${icon('check')}<span><strong>Foliación automática</strong> "FOLIO: 001" con sello rojo</span></li>
          <li>${icon('check')}<span>Finalidad probatoria y resaltado de cláusulas</span></li>
        </ul>
        <a class="btn btn-brand btn-lg" href="#pro" data-pro-open="legal">${icon('scale')}Quiero ${esc(SITE.name)} Legal</a>
        <a class="plan-link" href="armar-expediente.html">Probarlo gratis con marca de agua</a>
      </div>
      <div class="plan">
        <div class="plan-name">Estudio</div>
        <div class="plan-price">${esc(SITE.plans.equipo.currency)} ${esc(SITE.plans.equipo.price)} <small>/ ${esc(SITE.plans.equipo.period)}</small></div>
        <ul>
          <li>${icon('check')}<span>Plan Legal para hasta 5 personas</span></li>
          <li>${icon('check')}<span>Ideal para estudios jurídicos, notarías y despachos contables</span></li>
          <li>${icon('check')}<span>Capacitación por videollamada para tu equipo</span></li>
          <li>${icon('check')}<span>Atención preferente</span></li>
        </ul>
        <a class="btn btn-ghost btn-lg" href="#pro" data-pro-open="equipo">${icon('message-circle')}Quiero el plan Estudio</a>
      </div>
    </div>
    <div class="service-band">
      <div>
        <h3>¿No tienes tiempo? Te lo hacemos.</h3>
        <p>Envíanos tus archivos por WhatsApp y te devolvemos el PDF listo para tu trámite: unido, comprimido, firmado o convertido. Desde ${esc(SITE.currency)} ${esc(SITE.servicePrice)} por documento.</p>
      </div>
      <a class="btn btn-brand" data-wa="Hola, necesito que me ayuden con un documento" data-wa-fallback="disable">${icon('message-circle')}Pedir ayuda</a>
    </div>
  </div>
</section>

<section class="section" id="preguntas">
  <div class="wrap">
    <div class="section-head"><h2>Preguntas frecuentes</h2></div>
    <div class="faq">
      ${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n      ')}
    </div>
  </div>
</section>`,
});
writeFileSync(`${ROOT}index.html`, home);

/* ---------- Páginas de herramienta ---------- */

const PICK = {
  pdf: (multi) => [multi ? 'Seleccionar archivos PDF' : 'Seleccionar PDF', 'PDF'],
  image: () => ['Seleccionar imágenes', 'JPG, PNG, WEBP o GIF'],
  any: () => ['Seleccionar imagen o PDF', 'PDF, JPG, PNG o WEBP'],
  docx: (multi) => [multi ? 'Seleccionar archivos de Word' : 'Seleccionar archivo de Word', 'DOCX'],
  pptx: (multi) => [multi ? 'Seleccionar presentaciones' : 'Seleccionar presentación', 'PPTX'],
  sheet: (multi) => [multi ? 'Seleccionar hojas de Excel' : 'Seleccionar hoja de Excel', 'XLSX, XLS, ODS o CSV'],
  html: () => ['Seleccionar archivo HTML', 'HTML'],
};
const PICK_OVERRIDE = {
  'escanear-pdf': ['Tomar foto o elegir imágenes', 'Fotos JPG, PNG o HEIC del celular'],
  'comparar-pdf': ['Seleccionar 2 archivos PDF', 'PDF (el original y la versión nueva)'],
  'armar-expediente': ['Elegir escrito y pruebas', 'PDF: el primero será el escrito principal'],
};
const STEP2 = {
  'armar-expediente': ['Ordena y describe tus anexos', 'Etiquetas 1-A, 1-B…, finalidad probatoria, resaltado, carátula y foliación.'],
  'unir-pdf': ['Ordénalos', 'Arrastra los archivos para dejarlos en el orden que quieras.'],
  'dividir-pdf': ['Elige cómo dividir', 'Por rangos, cada cierto número de páginas o todas sueltas.'],
  'comprimir-pdf': ['Elige el nivel', 'Recomendada, extrema, sin pérdida o el peso máximo en MB que te piden.'],
  'jpg-a-pdf': ['Ordena y ajusta', 'Elige tamaño A4 o Carta, orientación y márgenes.'],
  'pdf-a-jpg': ['Elige la calidad', 'Normal para compartir, alta para imprimir. JPG o PNG.'],
  'firmar-pdf': ['Crea y coloca tu firma', 'Dibújala, escríbela o súbela, y tócala sobre la página.'],
  'organizar-pdf': ['Ordena tus páginas', 'Arrástralas, gíralas o elimina las que sobran.'],
  'rotar-pdf': ['Gira las páginas', 'Toca cada página o gíralas todas a la vez.'],
  'eliminar-paginas': ['Marca las páginas', 'Tócalas o escribe sus números, por ejemplo 2, 5-7.'],
  'extraer-paginas': ['Marca las páginas', 'Elige las que quieres llevar al nuevo PDF.'],
  'numerar-paginas': ['Elige el estilo', 'Posición, formato y número inicial.'],
  'marca-de-agua': ['Escribe tu marca', 'Elige texto, color, tamaño y transparencia.'],
  'proteger-pdf': ['Escribe una contraseña', 'Repítela para confirmar y guárdala bien.'],
  'desbloquear-pdf': ['Escribe la contraseña', 'Si solo tiene restricciones, déjala vacía.'],
  'ocr-pdf': ['Elige el idioma', 'Español, inglés o portugués.'],
  'firma-digital': ['Elige tu certificado', 'Tu archivo .pfx o .p12 y su contraseña. Nunca salen de tu equipo.'],
  'resumir-pdf': ['Elige el largo', 'Corto, medio o largo. Recibes las ideas principales en puntos.'],
  'escanear-pdf': ['Elige el acabado', 'Documento en blanco y negro, escala de grises o color mejorado.'],
  'reparar-pdf': ['Repara', 'DocuMaus reconstruye el archivo o rescata las páginas que se puedan leer.'],
  'word-a-pdf': ['Convierte', 'Cada página del Word se dibuja con su mismo diseño.'],
  'powerpoint-a-pdf': ['Convierte', 'Cada diapositiva se convierte en una página.'],
  'excel-a-pdf': ['Elige las hojas', 'Todas o solo la primera, en vertical u horizontal.'],
  'html-a-pdf': ['Elige el tamaño', 'A4 o Carta. También puedes pegar el código HTML.'],
  'pdf-a-word': ['Convierte', 'DocuMaus reconoce títulos, párrafos y viñetas.'],
  'pdf-a-powerpoint': ['Convierte', 'Cada página queda como una diapositiva.'],
  'pdf-a-excel': ['Elige cómo organizarlo', 'Todo en una hoja o una hoja por página.'],
  'pdf-a-pdfa': ['Elige el modo', 'Conservar el texto o máxima compatibilidad.'],
  'recortar-pdf': ['Marca la zona', 'Mueve las esquinas o usa "Quitar márgenes blancos".'],
  'editar-pdf': ['Edita', 'Agrega texto, imágenes, formas, resaltado o dibujos.'],
  'formularios-pdf': ['Rellena o crea campos', 'Llena los campos existentes o dibuja campos nuevos.'],
  'censurar-pdf': ['Marca lo que quieres tapar', 'Dibuja recuadros o busca una palabra para taparla en todo el documento.'],
  'comparar-pdf': ['Ordénalos', 'Primero el original y luego la versión nueva.'],
  'traducir-pdf': ['Elige el idioma', 'Español, inglés, portugués, francés y más.'],
  'pdf-a-markdown': ['Convierte', 'Títulos, párrafos y listas en formato Markdown.'],
};

function related(t) {
  const same = live.filter((x) => x.id !== t.id && x.cat === t.cat);
  const popular = ['unir-pdf', 'comprimir-pdf', 'jpg-a-pdf', 'firmar-pdf', 'pdf-a-jpg', 'dividir-pdf']
    .map((id) => live.find((x) => x.id === id)).filter((x) => x && x.id !== t.id && x.cat !== t.cat);
  return [...same, ...popular].slice(0, 6);
}

for (const t of live) {
  const mod = modules[t.id];
  const [pickLabel, formats] = PICK_OVERRIDE[t.id] || PICK[mod.accept || 'pdf'](mod.multiple);
  const [s2title, s2text] = STEP2[t.id];
  const html = page({
    head: head({
      title: `${t.title} | ${SITE.name}`,
      desc: t.desc,
      path: `${t.id}.html`,
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: `${t.name} · ${SITE.name}`,
        description: t.desc,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Web',
        inLanguage: 'es',
        offers: t.plan && SITE.plans?.[t.plan]
          ? { '@type': 'Offer', price: SITE.plans[t.plan].price, priceCurrency: 'USD' }
          : { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    }),
    bodyAttr: ` data-tool="${t.id}"`,
    main: `<section class="stage wrap" id="stage-select">
  <div class="tool-hero">
    <div>
      <span class="tile lg cat-${t.cat}">${icon(t.icon)}</span>
      <h1>${esc(t.name)}${t.pro ? ` <span class="badge plan-badge">${esc(SITE.name)} ${t.plan === 'legal' ? 'Legal' : 'Pro'}</span>` : ''}</h1>
      <p class="lead">${esc(t.short)}</p>
      <p class="privacy">${icon('shield-check')}<span>Tus archivos se procesan en tu dispositivo. Nunca se suben a internet.</span></p>
    </div>
    <div class="drop" id="drop">
      ${icon('cloud-upload', 'drop-icon')}
      <button class="btn btn-brand btn-xl" type="button" id="pick">${icon('upload')}${esc(pickLabel)}</button>
      <p class="drop-hint">o arrástra${mod.multiple ? 'los' : 'lo'} y suélta${mod.multiple ? 'los' : 'lo'} aquí</p>
      <p class="drop-formats">Formatos: ${esc(formats)}</p>
    </div>
  </div>
</section>

<section class="stage wrap" id="stage-work" hidden>
  <div class="work">
    <div class="work-main">
      <div class="work-toolbar" id="work-toolbar"></div>
      <div class="work-area" id="work-area"></div>
    </div>
    <aside class="work-side" aria-label="Opciones">
      <h2 class="side-title">${esc(t.name)}</h2>
      <div class="side-options" id="options"></div>
      <div class="side-action">
        <button class="btn btn-brand btn-lg btn-block" type="button" id="run"><span class="run-label">${esc(mod.actionLabel)}</span>${icon('arrow-right')}</button>
      </div>
    </aside>
  </div>
</section>

<section class="stage wrap" id="stage-done" hidden>
  <div class="done-slot" aria-live="polite"></div>
</section>

<section class="section">
  <div class="wrap howto">
    <div>
      <h2>Cómo usar ${esc(t.name)}</h2>
      <ol style="margin-top:20px">
        <li><div><strong>Elige tu archivo</strong><span>Toca "${esc(pickLabel)}" o arrastra ${mod.multiple ? 'tus archivos' : 'tu archivo'} a esta página.</span></div></li>
        <li><div><strong>${esc(s2title)}</strong><span>${esc(s2text)}</span></div></li>
        <li><div><strong>Descarga</strong><span>Toca "${esc(mod.actionLabel)}" y descarga el resultado. Listo.</span></div></li>
      </ol>
    </div>
    <div class="about">
      <h2>Sobre esta herramienta</h2>
      <p>${esc(t.about)}</p>
      <p>${t.pro
    ? `Es parte de ${esc(SITE.name)} ${t.plan === 'legal' ? 'Legal' : 'Pro'}: pruébalo gratis (el resultado sale con marca de agua) y activa tu plan para descargarlo limpio.`
    : 'Funciona en celular y computadora, es gratis y no necesitas registrarte.'}</p>
    </div>
  </div>
  <div class="wrap" style="margin-top:48px">
    <h2 style="font-size:1.4rem">Otras herramientas</h2>
    <div class="related">
      ${related(t).map((x) => toolCard(x, { small: true })).join('\n      ')}
    </div>
  </div>
</section>

<div class="busy" id="busy" hidden role="alertdialog" aria-live="assertive" aria-label="Procesando">
  <div class="busy-card"><span class="spinner"></span><p id="busy-label">Procesando…</p><div class="bar" id="busy-progress" role="progressbar" aria-label="Avance" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="busy-bar"></span></div><p class="busy-pct" id="busy-pct">0%</p></div>
</div>
<div class="drop-overlay" aria-hidden="true">Suelta tus archivos aquí</div>
<input type="file" id="file-input" hidden>`,
    scripts: `<script type="module" src="assets/js/tool-page.js?v=${VERSION}"></script>\n`,
  });
  writeFileSync(`${ROOT}${t.id}.html`, html);
}

/* ---------- Páginas legales ---------- */

function legal(file, title, desc, body) {
  writeFileSync(`${ROOT}${file}`, page({
    head: head({ title: `${title} | ${SITE.name}`, desc, path: file }),
    main: `<article class="wrap prose">\n<h1>${esc(title)}</h1>\n<p class="updated">Última actualización: ${new Date().toLocaleDateString('es', { year: 'numeric', month: 'long', day: 'numeric' })}</p>\n${body}\n</article>`,
  }));
}

legal('privacidad.html', 'Política de privacidad', `Cómo ${SITE.name} trata tus archivos y tus datos.`, `
<h2>Tus archivos</h2>
<p>${esc(SITE.name)} procesa tus documentos dentro de tu navegador. Tus PDF e imágenes no se envían a nuestros servidores ni a los de terceros. Cuando cierras o recargas la página, los archivos desaparecen de la memoria de tu equipo.</p>
<h2>Recursos que se descargan</h2>
<p>Para funcionar, la web descarga sus componentes de código abierto (lectores de PDF, compresión, OCR y modelos de idioma) desde la red de distribución jsDelivr, y las fuentes tipográficas desde Google Fonts. Solo se descargan programas: tus documentos nunca se envían a estos servicios. Como cualquier sitio web, estos servicios pueden registrar datos técnicos como tu dirección IP.</p>
<h2>Cookies y estadísticas</h2>
<p>${esc(SITE.name)} no usa cookies propias ni herramientas de seguimiento publicitario.${API_BASE ? ` Para mejorar el servicio registramos estadísticas anónimas de uso: qué herramienta usaste, el peso de los archivos y cuánto tardó. Nunca el archivo, su nombre ni su contenido.` : ''}</p>
<h2>Asistente de WhatsApp</h2>
<p>La web procesa todo en tu navegador. El asistente de WhatsApp es un servicio aparte y funciona distinto: si nos envías un PDF por WhatsApp, ese archivo sí se procesa en nuestro servidor para devolverte el resultado. Lo guardamos solo mientras dura la operación y lo borramos al terminar (como máximo a los 30 minutos si no eliges ninguna acción). Si pones una contraseña, la usamos solo para cifrar tu PDF y no la guardamos. Conservamos tu número y la cantidad de documentos procesados para controlar el cupo de tu plan. Puedes pedir que borremos tus datos escribiéndonos (Ley N.° 29733 de Protección de Datos Personales).</p>
<h2>Plan Pro y contacto</h2>
<p>Si nos escribes por WhatsApp o correo para contratar el plan Pro, usaremos tus datos de contacto solo para atenderte y gestionar tu pago. Tu código Pro se guarda solo en tu navegador.</p>
<h2>Certificados digitales</h2>
<p>Cuando usas "Firma digital", tu certificado y su contraseña se usan dentro de tu navegador y nunca se envían a internet ni se guardan.</p>
<h2>Cambios</h2>
<p>Podemos actualizar esta política. La fecha de arriba indica la última versión.</p>`);

legal('terminos.html', 'Términos de uso', `Condiciones para usar ${SITE.name}.`, `
<h2>Uso del servicio</h2>
<p>${esc(SITE.name)} ofrece herramientas para trabajar con archivos PDF. Puedes usarlas gratis para fines personales y comerciales.</p>
<h2>Uso responsable</h2>
<p>Solo debes procesar documentos que te pertenecen o que tienes permiso para modificar. Está prohibido usar ${esc(SITE.name)} para quitar protecciones de documentos ajenos, falsificar firmas o cometer cualquier acto ilegal.</p>
<h2>Firmas</h2>
<p>La herramienta Firmar PDF coloca una imagen de tu firma. No es una firma digital certificada y su validez depende de la normativa de tu país y de quien recibe el documento.</p>
<h2>Sin garantías</h2>
<p>El servicio se ofrece "tal cual". Revisa siempre el resultado antes de enviarlo o imprimirlo. Guarda una copia de tus archivos originales.</p>
<h2>Plan Pro</h2>
<p>El plan Pro es una suscripción opcional que se activa con un código personal e intransferible. Las condiciones de pago y cancelación se acuerdan al momento de contratarlo.</p>
<h2>Firma digital</h2>
<p>${esc(SITE.name)} no es una entidad de certificación. La herramienta "Firma digital" usa el certificado que tú cargas; su validez depende de quién lo emitió y del trámite en que lo uses.</p>`);

/* ---------- Flujos, panel del dueño y service worker ---------- */

writeFileSync(`${ROOT}flujos.html`, page({
  head: head({ title: `Flujos de trabajo PDF | ${SITE.name}`, desc: 'Encadena herramientas PDF: expedientes para mesa de partes, contratos firmados, escaneos con OCR y más, sin descargar y volver a subir.', path: 'flujos.html' }),
  main: `<section class="wrap home-hero">
  <span class="eyebrow"><span class="dot"></span>${esc(SITE.name)} Pro</span>
  <h1>Flujos de trabajo</h1>
  <p class="lead">Elige un flujo y sigue los pasos. El resultado de cada herramienta pasa solo a la siguiente, sin descargar ni volver a subir nada.</p>
</section>
<div class="wrap" style="padding-bottom:56px">
  <div class="flows">
    ${FLOWS.map((f) => flowCard(f)).join('\n    ')}
  </div>
</div>`,
}));

writeFileSync(`${ROOT}admin.html`, page({
  head: head({ title: `Panel | ${SITE.name}`, desc: 'Panel del dueño.', path: 'admin.html' }).replace('<head>', '<head>\n<meta name="robots" content="noindex, nofollow">'),
  main: `<section class="wrap prose admin-page">
  <h1>Panel de ${esc(SITE.name)}</h1>
  <p>Esta página es solo para ti. Aquí creas los códigos Pro que vendes y llevas la lista de tus clientes. Todo se guarda en este navegador.</p>
  <div id="admin"><p class="field-hint">Cargando…</p></div>
</section>`,
  scripts: `<script type="module" src="assets/js/admin.js?v=${VERSION}"></script>\n`,
}));

// Archivos que el service worker guarda para funcionar sin internet
const jsFiles = [
  ...readdirSync(`${ROOT}assets/js`).filter((f) => f.endsWith('.js') && !f.startsWith('sw-')).map((f) => `assets/js/${f}`),
  ...readdirSync(`${ROOT}assets/js/tools`).filter((f) => f.endsWith('.js')).map((f) => `assets/js/tools/${f}`),
  ...readdirSync(`${ROOT}assets/workers`).filter((f) => f.endsWith('.js')).map((f) => `assets/workers/${f}`),
];
const shell = [
  'index.html', 'flujos.html', ...live.map((t) => `${t.id}.html`), 'privacidad.html', 'terminos.html',
  `assets/css/maus.css?v=${VERSION}`, `assets/js/site.js?v=${VERSION}`, `assets/js/tool-page.js?v=${VERSION}`, ...jsFiles,
  'assets/img/favicon.svg', 'assets/img/icon-192.png', 'manifest.webmanifest',
];
writeFileSync(`${ROOT}sw.js`, readFileSync(`${ROOT}assets/js/sw-template.js`, 'utf8')
  .replace('__VERSION__', VERSION)
  .replace('__SHELL__', JSON.stringify(shell, null, 2)));

/* ---------- 404, sitemap y robots ---------- */

// La 404 puede mostrarse en cualquier ruta: con <base> sus enlaces y estilos siguen funcionando.
writeFileSync(`${ROOT}404.html`, page({
  head: head({ title: `Página no encontrada | ${SITE.name}`, desc: 'Esta página no existe.', path: '404.html' })
    .replace('<head>', SITE_URL ? `<head>\n<base href="${esc(SITE_URL)}/">` : '<head>'),
  main: `<section class="wrap prose"><h1>Esta página no existe</h1><p>Puede que el enlace esté mal escrito o que la página se haya movido.</p><p style="margin-top:24px"><a class="btn btn-brand btn-lg" href="index.html">Ver todas las herramientas</a></p></section>`,
}));

if (SITE_URL) {
  const urls = ['', 'flujos.html', ...live.map((t) => `${t.id}.html`), 'privacidad.html', 'terminos.html'];
  writeFileSync(`${ROOT}sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(abs(u))}</loc></url>`).join('\n')}
</urlset>
`);
} else {
  // Un sitemap exige direcciones absolutas: sin SITE_URL no se publica ninguno.
  rmSync(`${ROOT}sitemap.xml`, { force: true });
}
writeFileSync(`${ROOT}robots.txt`, `User-agent: *\nAllow: /\nDisallow: /admin.html\n${SITE_URL ? `Sitemap: ${abs('sitemap.xml')}\n` : ''}`);

console.log(`Listo: index.html, ${live.length} herramientas, privacidad, términos y 404.`);
