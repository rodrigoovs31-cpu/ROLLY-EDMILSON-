// Genera todas las páginas HTML de la web a partir de assets/js/tools-data.js y config.js.
// Uso: npm run build   (o: node scripts/build.mjs)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SITE } from '../assets/js/config.js';
import { TOOLS, CATEGORIES } from '../assets/js/tools-data.js';
import { icon } from '../assets/js/icons.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VERSION = Date.now().toString(36);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (path) => (SITE.url ? `${SITE.url.replace(/\/$/, '')}/${path}` : path);
const live = TOOLS.filter((t) => t.status === 'ok');

const modules = Object.fromEntries(await Promise.all(live.map(async (t) =>
  [t.id, (await import(`../assets/js/tools/${t.module}.js`)).default])));

const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="lg-body" cx="12" cy="11" r="8.5"/><circle class="lg-accent" cx="12" cy="11" r="4.4"/><circle class="lg-body" cx="36" cy="11" r="8.5"/><circle class="lg-accent" cx="36" cy="11" r="4.4"/><path class="lg-body" d="M15 9h18a7 7 0 0 1 7 7v17L29 44H15a7 7 0 0 1-7-7V16a7 7 0 0 1 7-7Z"/><path class="lg-accent" d="M40 33h-6a5 5 0 0 0-5 5v6Z"/><circle class="lg-eye" cx="18" cy="24" r="2.5"/><circle class="lg-eye" cx="30" cy="24" r="2.5"/><path class="lg-accent" d="M21.6 30.4h4.8L24 33.2Z" stroke="var(--brand)" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

function head({ title, desc, path, jsonld }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${SITE.url ? `<link rel="canonical" href="${esc(abs(path))}">\n` : ''}<meta name="theme-color" content="#FFC21A">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(abs('assets/img/og.png'))}">
<meta property="og:locale" content="es_LA">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/img/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Figtree:wght@400..700&display=swap">
<link rel="stylesheet" href="assets/css/maus.css?v=${VERSION}">
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>\n` : ''}</head>`;
}

function header() {
  return `<header class="site-header">
  <div class="wrap">
    <a class="brand" href="index.html" aria-label="${esc(SITE.name)}, inicio">${LOGO}<span class="brand-name">${esc(SITE.name.toLowerCase())}</span></a>
    <nav class="nav" aria-label="Principal">
      <a href="index.html#herramientas">Herramientas</a>
      <a class="nav-link-optional" href="index.html#preguntas">Ayuda</a>
      <a class="btn btn-brand sm" href="index.html#planes">Hazte Pro</a>
    </nav>
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
        <a class="brand" href="index.html">${LOGO}<span class="brand-name">${esc(SITE.name.toLowerCase())}</span></a>
        <p>Herramientas PDF gratis, rápidas y privadas. Hechas en español para tus trámites de todos los días.</p>
      </div>
      <div><h4>Herramientas</h4><ul>${col(byId(['unir-pdf', 'dividir-pdf', 'comprimir-pdf', 'jpg-a-pdf', 'firmar-pdf']))}</ul></div>
      <div><h4>Más</h4><ul>${col(byId(['pdf-a-jpg', 'organizar-pdf', 'proteger-pdf', 'desbloquear-pdf', 'ocr-pdf']))}</ul></div>
      <div><h4>${esc(SITE.name)}</h4><ul>
        <li><a href="index.html#planes">Planes</a></li>
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
      ${t.status === 'ok' ? '' : '<span class="badge">Pronto</span>'}
    </${tag}>`;
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
  ['¿Puedo convertir Word a PDF?', 'Muy pronto. Esa conversión necesita un servidor y la estamos preparando. Mientras tanto, en Word puedes usar Archivo › Guardar como › PDF.'],
  [`¿La firma de ${SITE.name} tiene validez legal?`, `${SITE.name} coloca una imagen de tu firma (firma visual). Sirve para la mayoría de documentos del día a día, pero no reemplaza a una firma digital certificada.`],
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
  <p class="lead">Une, divide, comprime, convierte, firma y protege tus documentos. Gratis y sin registrarte. Tus archivos no se suben a ningún servidor: todo pasa dentro de tu navegador.</p>
  <div class="filters" role="toolbar" aria-label="Filtrar herramientas">
    <button class="chip" type="button" data-cat="all" aria-pressed="true">Todas</button>
    ${CATEGORIES.map((c) => `<button class="chip" type="button" data-cat="${c.id}" aria-pressed="false">${esc(c.name)}</button>`).join('\n    ')}
  </div>
</section>
<div class="wrap">
  <div class="tools-grid">
    ${TOOLS.map((t) => toolCard(t)).join('\n    ')}
  </div>
</div>

<section class="section">
  <div class="wrap">
    <div class="section-head">
      <h2>Hecho para tus trámites de todos los días</h2>
      <p>Postulaciones, matrículas, contratos, recibos. ${esc(SITE.name)} te deja el documento listo para enviar.</p>
    </div>
    <div class="benefits">
      <div class="benefit">${icon('shield-check')}<h3>Tus archivos no salen de tu equipo</h3><p>Todo se procesa en tu navegador. Nadie más ve tus documentos, ni siquiera nosotros.</p></div>
      <div class="benefit">${icon('smartphone')}<h3>Funciona en tu celular</h3><p>Firma, comprime o une PDF desde el teléfono, sin instalar ninguna app.</p></div>
      <div class="benefit">${icon('zap')}<h3>Rápido y sin registro</h3><p>Entra, elige tu archivo y descárgalo listo. Sin cuentas y sin esperas.</p></div>
      <div class="benefit">${icon('badge-check')}<h3>Sin marcas de agua</h3><p>Tus documentos salen limpios, sin logos ni sellos de ${esc(SITE.name)}.</p></div>
    </div>
  </div>
</section>

<section class="section" id="planes">
  <div class="wrap">
    <div class="section-head">
      <h2>Planes</h2>
      <p>Todas las herramientas son gratis. Con Pro recibes ayuda personal y acceso primero a las novedades.</p>
    </div>
    <div class="plans">
      <div class="plan">
        <div class="plan-name">Gratis</div>
        <div class="plan-price">${esc(SITE.currency)} 0 <small>para siempre</small></div>
        <ul>
          <li>${icon('check')}<span>Las ${live.length} herramientas</span></li>
          <li>${icon('check')}<span>Sin límite de archivos</span></li>
          <li>${icon('check')}<span>Sin registro y sin marcas de agua</span></li>
          <li>${icon('check')}<span>Tus archivos nunca salen de tu equipo</span></li>
        </ul>
        <a class="btn btn-ghost btn-lg" href="#herramientas">Usar gratis</a>
      </div>
      <div class="plan pro">
        <div class="plan-name">Pro <span class="badge ok">Recomendado</span></div>
        <div class="plan-price"><span data-price>${esc(SITE.currency)} ${esc(SITE.proPrice)}</span> <small data-period>/ ${esc(SITE.proPeriod)}</small></div>
        <ul>
          <li>${icon('check')}<span>Todo lo del plan Gratis</span></li>
          <li>${icon('check')}<span>Ayuda personal por WhatsApp con tus documentos</span></li>
          <li>${icon('check')}<span>Conversión de Word, Excel y PowerPoint a PDF</span></li>
          <li>${icon('check')}<span>Acceso anticipado a nuevas herramientas</span></li>
        </ul>
        <p class="pay-methods">${icon('sparkles')}<span>Paga con <span data-pay>${esc(SITE.paymentMethods.join(' · '))}</span></span></p>
        <a class="btn btn-brand btn-lg" data-wa="Hola, quiero el plan ${esc(SITE.name)} Pro" data-wa-fallback="disable">${icon('message-circle')}Quiero ${esc(SITE.name)} Pro</a>
      </div>
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
};
const STEP2 = {
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
};

function related(t) {
  const same = live.filter((x) => x.id !== t.id && x.cat === t.cat);
  const popular = ['unir-pdf', 'comprimir-pdf', 'jpg-a-pdf', 'firmar-pdf', 'pdf-a-jpg', 'dividir-pdf']
    .map((id) => live.find((x) => x.id === id)).filter((x) => x && x.id !== t.id && x.cat !== t.cat);
  return [...same, ...popular].slice(0, 6);
}

for (const t of live) {
  const mod = modules[t.id];
  const [pickLabel, formats] = PICK[mod.accept || 'pdf'](mod.multiple);
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
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      },
    }),
    bodyAttr: ` data-tool="${t.id}"`,
    main: `<section class="stage wrap" id="stage-select">
  <div class="tool-hero">
    <div>
      <span class="tile lg cat-${t.cat}">${icon(t.icon)}</span>
      <h1>${esc(t.name)}</h1>
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
      <p>Funciona en celular y computadora, es gratis y no necesitas registrarte.</p>
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
  <div class="busy-card"><span class="spinner"></span><p id="busy-label">Procesando…</p><div class="bar"><span id="busy-bar"></span></div></div>
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
<p>Para mostrar la web se cargan fuentes tipográficas de Google Fonts. La herramienta de OCR descarga el motor de reconocimiento y el modelo del idioma desde la red de distribución jsDelivr. Estos servicios pueden registrar datos técnicos como tu dirección IP, igual que cualquier sitio web.</p>
<h2>Cookies y estadísticas</h2>
<p>Actualmente ${esc(SITE.name)} no usa cookies propias ni herramientas de seguimiento. Si en el futuro agregamos estadísticas o publicidad, lo indicaremos en esta página.</p>
<h2>Plan Pro y contacto</h2>
<p>Si nos escribes por WhatsApp o correo para contratar el plan Pro, usaremos tus datos de contacto solo para atenderte y gestionar tu pago.</p>
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
<p>El plan Pro es una suscripción opcional. Las condiciones de pago y cancelación se acuerdan al momento de contratarlo.</p>`);

/* ---------- 404, sitemap y robots ---------- */

// La 404 puede mostrarse en cualquier ruta: con <base> sus enlaces y estilos siguen funcionando.
writeFileSync(`${ROOT}404.html`, page({
  head: head({ title: `Página no encontrada | ${SITE.name}`, desc: 'Esta página no existe.', path: '404.html' })
    .replace('<head>', SITE.url ? `<head>\n<base href="${esc(SITE.url.replace(/\/$/, ''))}/">` : '<head>'),
  main: `<section class="wrap prose"><h1>Esta página no existe</h1><p>Puede que el enlace esté mal escrito o que la página se haya movido.</p><p style="margin-top:24px"><a class="btn btn-brand btn-lg" href="index.html">Ver todas las herramientas</a></p></section>`,
}));

if (SITE.url) {
  const urls = ['', ...live.map((t) => `${t.id}.html`), 'privacidad.html', 'terminos.html'];
  writeFileSync(`${ROOT}sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(abs(u))}</loc></url>`).join('\n')}
</urlset>
`);
}
writeFileSync(`${ROOT}robots.txt`, `User-agent: *\nAllow: /\n${SITE.url ? `Sitemap: ${abs('sitemap.xml')}\n` : ''}`);

console.log(`Listo: index.html, ${live.length} herramientas, privacidad, términos y 404.`);
