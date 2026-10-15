// Controlador común de cada página de herramienta:
// elegir archivos → ajustar opciones → procesar → descargar.
import { SITE } from './config.js';
import { toolById, FLOWS, CONTINUE_WITH } from './tools-data.js';
import { $, h, iconEl, toast } from './ui.js';
import { loadPro, isPro, requirePro, freeLimit, openProModal } from './pro.js';
import { saveHandoff, takeHandoff } from './handoff.js';
import {
  isPdf, isImage, fmtSize, readBytes, openPdfjs, renderThumb, getSortable,
  downloadBlob, zipBlobs, UserError, yieldUI,
} from './lib.js';
import { mountPages } from './pages-view.js';

const tool = toolById(document.body.dataset.tool);
const mod = (await import(`./tools/${tool.module}.js`)).default;
await loadPro();

// Flujo de trabajo en curso (?flujo=id&paso=n) y archivo recibido de otra herramienta (?continuar=1)
const params = new URLSearchParams(location.search);
const flow = FLOWS.find((f) => f.id === params.get('flujo'));
const flowStep = flow ? Math.max(0, Math.min(flow.steps.length - 1, Number(params.get('paso')) || 0)) : 0;

const el = {
  select: $('#stage-select'),
  work: $('#stage-work'),
  done: $('#stage-done'),
  area: $('#work-area'),
  toolbar: $('#work-toolbar'),
  options: $('#options'),
  run: $('#run'),
  input: $('#file-input'),
  busy: $('#busy'),
  busyLabel: $('#busy-label'),
  busyBar: $('#busy-bar'),
  busyProgress: $('#busy-progress'),
  busyPct: $('#busy-pct'),
};

// Barra de progreso suave: se anima con transform (sin recalcular el diseño) en cada cuadro,
// así avanza fluida a 60 FPS mientras el Web Worker procesa en otro hilo.
const bar = { target: 0, shown: 0, raf: 0 };
function paintBar() {
  bar.shown += (bar.target - bar.shown) * 0.2;
  if (Math.abs(bar.target - bar.shown) < 0.001) bar.shown = bar.target;
  const pct = Math.round(bar.shown * 100);
  el.busyBar.style.transform = `scaleX(${bar.shown})`;
  if (el.busyPct) el.busyPct.textContent = `${pct}%`;
  el.busyProgress?.setAttribute('aria-valuenow', String(pct));
  bar.raf = bar.shown === bar.target ? 0 : requestAnimationFrame(paintBar);
}
function resetBar() {
  cancelAnimationFrame(bar.raf);
  bar.raf = 0;
  bar.target = bar.shown = 0;
  paintBar();
}

const ACCEPT = {
  pdf: { attr: 'application/pdf,.pdf', test: isPdf, msg: 'Solo se aceptan archivos PDF.' },
  image: { attr: 'image/*', test: isImage, msg: 'Solo se aceptan imágenes (JPG, PNG, WEBP).' },
  any: { attr: 'application/pdf,.pdf,image/*', test: (f) => isPdf(f) || isImage(f), msg: 'Solo se aceptan PDF o imágenes.' },
  docx: {
    attr: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', test: (f) => /\.docx$/i.test(f.name),
    msg: 'Solo se aceptan documentos .docx. Si tu archivo es .doc, ábrelo en Word y usa "Guardar como" .docx.',
  },
  pptx: {
    attr: '.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation', test: (f) => /\.pptx$/i.test(f.name),
    msg: 'Solo se aceptan presentaciones .pptx. Si tu archivo es .ppt, ábrelo en PowerPoint y usa "Guardar como" .pptx.',
  },
  sheet: { attr: '.xlsx,.xlsm,.xls,.ods,.csv', test: (f) => /\.(xlsx|xlsm|xls|ods|csv)$/i.test(f.name), msg: 'Solo se aceptan hojas de cálculo XLSX, XLS, ODS o CSV.' },
  html: { attr: '.html,.htm,text/html', test: (f) => /\.html?$/i.test(f.name), msg: 'Solo se aceptan archivos .html.' },
};
const accept = ACCEPT[mod.accept || 'pdf'];
el.input.accept = accept.attr;
el.input.multiple = !!mod.multiple;
el.run.querySelector('.run-label').textContent = mod.actionLabel || tool.name;

let seq = 0;
const ctx = {
  tool,
  files: [],
  opts: {},
  pages: null,
  area: el.area,
  toolbar: el.toolbar,
  optionsEl: el.options,
  progress(fraction, label) {
    if (label) el.busyLabel.textContent = label;
    if (fraction != null && Number.isFinite(fraction)) {
      bar.target = Math.min(1, Math.max(0, fraction));
      bar.raf ||= requestAnimationFrame(paintBar);
    }
  },
  pickFiles: () => el.input.click(),
  refresh: () => renderView(),
  setRunEnabled(on, why) {
    el.run.disabled = !on;
    el.run.title = on ? '' : (why || '');
  },
  // info de un archivo: { pages, locked, thumb }
  info: (entry) => fileInfo(entry),
};

let workReady = false;

function show(stage) {
  for (const s of [el.select, el.work, el.done]) s.hidden = s !== stage;
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

/* ---------- Entrada de archivos ---------- */

if (flow) {
  const banner = h('div.flow-banner.wrap', {},
    iconEl('layers'),
    h('span', {}, h('strong', {}, flow.name), ` · Paso ${flowStep + 1} de ${flow.steps.length}: ${tool.name}`),
    h('ol.flow-steps', {}, flow.steps.map((id, i) => h('li', { class: i < flowStep ? 'is-done' : i === flowStep ? 'is-current' : '' }, toolById(id).name))));
  $('main').prepend(banner);
  if (!isPro()) requirePro('flujos', 'Los flujos de trabajo son parte de Maus Pro.');
}

$('#pick').addEventListener('click', () => el.input.click());
// Algunas herramientas agregan otra forma de empezar (por ejemplo, pegar código HTML).
mod.selectExtras?.($('#drop'), (files) => addFiles(files));
el.input.addEventListener('change', () => {
  addFiles([...el.input.files]);
  el.input.value = '';
});

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  dragDepth++;
  document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => {
  if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  if (!el.done.hidden) return;
  addFiles([...e.dataTransfer.files]);
});

async function addFiles(list) {
  const ok = list.filter(accept.test);
  if (ok.length < list.length) toast(accept.msg, 'error');
  if (!ok.length) return;

  const fresh = ok.map((file) => ({
    id: ++seq, file, name: file.name, size: file.size,
    kind: isPdf(file) ? 'pdf' : isImage(file) ? 'image' : 'doc',
  }));
  if (mod.multiple) {
    ctx.files.push(...fresh);
    if (mod.maxFiles && ctx.files.length > mod.maxFiles) {
      ctx.files.splice(0, ctx.files.length - mod.maxFiles);
      toast(`Esta herramienta usa ${mod.maxFiles} archivos. Nos quedamos con los últimos.`);
    }
  }
  else {
    if (fresh.length > 1) toast('Esta herramienta trabaja con un archivo a la vez. Usamos el primero.');
    ctx.files.splice(0, ctx.files.length, fresh[0]);
    workReady = false;
  }

  if (!workReady) await enterWork();
  else renderView();
}

async function enterWork() {
  workReady = true;
  show(el.work);
  el.options.replaceChildren();
  el.toolbar.replaceChildren();
  ctx.setRunEnabled(true);
  ctx.pages?.destroy();
  ctx.pages = null;

  try {
    if (mod.view === 'pages') {
      el.area.replaceChildren(h('div.loading', {}, h('span.spinner'), 'Cargando páginas…'));
      ctx.pages = await mountPages(el.area, ctx.files[0], { ...mod.pagesConfig, onChange: () => mod.onChange?.(ctx) });
      buildPagesToolbar();
    } else if (mod.view === 'custom') {
      await mod.mountView(ctx);
    } else {
      renderView();
    }
    await mod.options?.(ctx, el.options);
    mod.onChange?.(ctx);
  } catch (err) {
    report(err);
    reset();
  }
}

function reset() {
  ctx.pages?.destroy();
  ctx.pages = null;
  ctx.files.length = 0;
  ctx.opts = {};
  workReady = false;
  mod.reset?.(ctx);
  show(el.select);
}

/* ---------- Vista de archivos ---------- */

const infoCache = new WeakMap();
function fileInfo(entry) {
  if (!infoCache.has(entry)) {
    infoCache.set(entry, (async () => {
      if (entry.kind === 'doc') {
        const ext = (entry.name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toUpperCase();
        const iconName = /^DOC/.test(ext) ? 'file-text' : /^PPT/.test(ext) ? 'presentation' : /^(XLS|ODS|CSV)/.test(ext) ? 'sheet' : 'file-code';
        return { pages: null, locked: false, thumb: h('div.doc-thumb', {}, iconEl(iconName), h('span', {}, ext)) };
      }
      if (entry.kind === 'image') {
        const url = URL.createObjectURL(entry.file);
        return { pages: 1, locked: false, thumb: h('img', { src: url, alt: '' }) };
      }
      try {
        const doc = await openPdfjs(await readBytes(entry.file));
        const thumb = await renderThumb(await doc.getPage(1), 170);
        const info = { pages: doc.numPages, locked: false, thumb };
        doc.destroy();
        return info;
      } catch (err) {
        return { pages: null, locked: /contraseña/.test(err.message), error: err.message, thumb: iconEl('lock') };
      }
    })());
  }
  return infoCache.get(entry);
}

let sortable;
async function renderView() {
  if (mod.view === 'pages' || mod.view === 'custom') return;
  if (!ctx.files.length) { reset(); return; }

  const grid = h('div.fgrid');
  for (const entry of ctx.files) {
    const meta = h('span.fsize', {}, fmtSize(entry.size));
    const card = h('div.fcard', { dataset: { id: entry.id } },
      h('div.fthumb', {}, h('span.spinner.sm')),
      h('div.fmeta', {}, h('span.fname', { title: entry.name }, entry.name), meta),
      h('button.icon-btn.sm.fremove', {
        type: 'button', 'aria-label': `Quitar ${entry.name}`, title: 'Quitar',
        onclick: () => { ctx.files.splice(ctx.files.indexOf(entry), 1); renderView(); mod.onChange?.(ctx); },
      }, iconEl('x')));
    grid.append(card);
    fileInfo(entry).then((info) => {
      card.querySelector('.fthumb').replaceChildren(cloneThumb(info.thumb));
      if (info.pages && entry.kind === 'pdf') meta.textContent = `${info.pages} ${info.pages === 1 ? 'página' : 'páginas'} · ${fmtSize(entry.size)}`;
      if (info.locked) { card.classList.add('is-locked'); meta.textContent = `Con contraseña · ${fmtSize(entry.size)}`; }
      else if (info.error) { card.classList.add('is-error'); meta.textContent = 'No se puede leer'; }
      mod.onChange?.(ctx);
    });
  }
  if (mod.multiple) {
    grid.append(h('button.fcard.fadd', { type: 'button', onclick: () => el.input.click() },
      iconEl('plus'), h('span', {}, mod.accept === 'image' ? 'Añadir imágenes' : 'Añadir archivos')));
  }
  if (mod.maxFiles && ctx.files.length >= mod.maxFiles) grid.querySelector('.fadd')?.remove();
  el.area.replaceChildren(grid);

  el.toolbar.replaceChildren(
    h('span.toolbar-info', {}, `${ctx.files.length} ${ctx.files.length === 1 ? 'archivo' : 'archivos'}`),
    mod.sortable && ctx.files.length > 1 ? h('span.toolbar-hint', {}, 'Arrastra para cambiar el orden') : null,
    mod.sortable && ctx.files.length > 1 ? h('button.btn.btn-ghost.sm', {
      type: 'button',
      onclick: () => { ctx.files.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true })); renderView(); },
    }, iconEl('arrow-down-a-z'), 'Ordenar A–Z') : null,
  );

  if (mod.sortable) {
    const Sortable = await getSortable();
    sortable?.destroy();
    sortable = Sortable.create(grid, {
      animation: 160,
      draggable: '.fcard:not(.fadd)',
      filter: '.fremove',
      preventOnFilter: false,
      delay: 120,
      delayOnTouchOnly: true,
      ghostClass: 'is-ghost',
      onEnd: () => {
        const ids = [...grid.querySelectorAll('.fcard[data-id]')].map((c) => Number(c.dataset.id));
        ctx.files.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      },
    });
  }
}

function cloneThumb(node) {
  if (node instanceof HTMLCanvasElement) {
    const c = document.createElement('canvas');
    c.width = node.width; c.height = node.height;
    c.getContext('2d').drawImage(node, 0, 0);
    return c;
  }
  return node.cloneNode(true);
}

function buildPagesToolbar() {
  const p = ctx.pages;
  const cfg = mod.pagesConfig;
  const items = [h('span.toolbar-info', {}, `${p.numPages} ${p.numPages === 1 ? 'página' : 'páginas'}`)];
  if (cfg.rotate) {
    items.push(h('span.rotate-all', {},
      h('span.toolbar-hint', {}, 'Girar todas:'),
      h('button.icon-btn.sm', { type: 'button', title: 'Girar todas a la izquierda', 'aria-label': 'Girar todas a la izquierda', onclick: () => p.rotateAll(-90) }, iconEl('rotate-ccw')),
      h('button.icon-btn.sm', { type: 'button', title: 'Girar todas a la derecha', 'aria-label': 'Girar todas a la derecha', onclick: () => p.rotateAll(90) }, iconEl('rotate-cw'))));
  }
  if (cfg.select) {
    items.push(
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => p.setSelection(new Set(p.pages.map((x) => x.index + 1))) }, 'Marcar todas'),
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => p.setSelection(new Set()) }, 'Ninguna'),
    );
  }
  if (cfg.hint) items.push(h('span.toolbar-hint', {}, cfg.hint));
  el.toolbar.replaceChildren(...items);
}

/* ---------- Procesar ---------- */

el.run.addEventListener('click', async () => {
  const problem = mod.validate?.(ctx);
  if (problem) { toast(problem, 'error'); return; }
  if (tool.pro && !requirePro(tool.id, `${tool.name} es parte de Maus Pro.`)) return;
  if (flow && !requirePro('flujos', 'Los flujos de trabajo son parte de Maus Pro.')) return;
  const maxFiles = freeLimit('files');
  if (!isPro() && ctx.files.length > maxFiles) {
    openProModal(`El plan gratis procesa hasta ${maxFiles} archivos a la vez. Con Pro no hay límite.`);
    return;
  }
  el.busy.hidden = false;
  resetBar();
  ctx.progress(0, mod.busyLabel || 'Procesando…');
  await yieldUI();
  const started = performance.now();
  try {
    const result = await mod.run(ctx);
    ctx.progress(1);
    reportJob(tool.id, ctx.files, result, performance.now() - started);
    await showDone(result);
  } catch (err) {
    report(err);
  } finally {
    el.busy.hidden = true;
  }
});

// Estadística anónima (solo si la web corre en nuestro servidor con API_BASE):
// herramienta, pesos y tiempo. Nunca el archivo ni su nombre.
function reportJob(action, inputs, result, ms) {
  if (!SITE.api) return;
  try {
    const body = JSON.stringify({
      action,
      file_size_in: inputs.reduce((sum, f) => sum + (f.size || 0), 0),
      file_size_out: (result.files || []).reduce((sum, f) => sum + (f.blob?.size || 0), 0),
      processing_time_ms: Math.round(ms),
    });
    const url = `${SITE.api}/jobs`;
    if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' }))) {
      fetch(url, { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* las estadísticas nunca deben romper la herramienta */ }
}

// "📲 Enviar este documento a mi WhatsApp".
// En celulares (Android, iPhone) comparte el ARCHIVO con la hoja de compartir del sistema:
// eliges WhatsApp y tu propio chat. Donde eso no existe (computadoras), el enlace
// wa.me/?text= abre WhatsApp con el mensaje listo y descargamos el archivo para adjuntarlo,
// porque un enlace de WhatsApp no puede llevar archivos.
function whatsappShare(main, files) {
  const pageUrl = SITE.url ? `${SITE.url}/${tool.id}.html` : new URL(`${tool.id}.html`, document.baseURI).href;
  const text = `📄 ${main.name} (${fmtSize(main.blob.size)})\nListo con ${SITE.name}, herramientas PDF gratis: ${pageUrl}`;
  const href = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const list = files.length > 1 && files.length <= 10 ? files : [main];
  const shareFiles = list.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
  let canShareFiles = false;
  try { canShareFiles = !!navigator.canShare?.({ files: shareFiles }); } catch { canShareFiles = false; }

  const btn = h('a.btn.btn-wa.btn-lg#send-whatsapp', {
    href, target: '_blank', rel: 'noopener',
    'data-share': canShareFiles ? 'files' : 'link',
    onclick: async (event) => {
      if (canShareFiles) {
        event.preventDefault();
        try {
          await navigator.share({ files: shareFiles, title: main.name, text: `Listo con ${SITE.name}` });
        } catch (err) {
          if (err?.name === 'AbortError') return;  // el usuario cerró la hoja de compartir
          downloadBlob(main.blob, main.name);
          window.open(href, '_blank', 'noopener');
        }
        return;
      }
      downloadBlob(main.blob, main.name);
      toast('Descargamos tu archivo. En WhatsApp tócale 📎 para adjuntarlo.');
    },
  }, '📲 Enviar este documento a mi WhatsApp');
  return h('div.wa-share', {}, btn,
    h('p.wa-hint', {}, canShareFiles
      ? 'Elige WhatsApp y luego tu propio chat ("Tú") para guardarlo o reenviarlo.'
      : 'Se abre WhatsApp con el mensaje listo; adjunta con 📎 el archivo que se descarga.'));
}

function report(err) {
  if (!(err instanceof UserError)) console.error(err);
  toast(err instanceof UserError ? err.message : `Algo salió mal: ${err.message || err}`, 'error');
}

async function showDone(result) {
  const files = result.files || [];
  let main = null;
  if (files.length === 1) main = files[0];
  else if (files.length > 1) {
    ctx.progress(null, 'Preparando ZIP…');
    main = { name: result.zipName || `maus-${tool.id}.zip`, blob: await zipBlobs(files) };
  }

  const box = h('div.done-card', {},
    h('div.done-icon', {}, iconEl('check')),
    h('h1.done-title', {}, result.title || '¡Listo!'),
    result.summary ? h('p.done-summary', {}, result.summary) : null,
    result.details || null,
  );

  if (main) {
    const btn = h('button.btn.btn-brand.btn-xl', { type: 'button', id: 'download', onclick: () => downloadBlob(main.blob, main.name) },
      iconEl('download'), files.length > 1 ? `Descargar ZIP (${files.length} archivos)` : 'Descargar');
    box.append(btn, h('p.done-file', {}, `${main.name} · ${fmtSize(main.blob.size)}`), whatsappShare(main, files));
    if (files.length > 1 && files.length <= 30) {
      box.append(h('details.done-list', {},
        h('summary', {}, 'Descargar archivos por separado'),
        h('ul', {}, files.map((f) => h('li', {},
          h('button.linklike', { type: 'button', onclick: () => downloadBlob(f.blob, f.name) }, f.name),
          h('span', {}, fmtSize(f.blob.size)))))));
    }
  }

  // Seguir trabajando con el resultado en otra herramienta
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
  const goTo = async (id, query = 'continuar=1') => {
    try { await saveHandoff(pdfs); } catch { toast('Tu navegador no permitió pasar el archivo. Descárgalo y súbelo en la otra herramienta.', 'error'); return; }
    location.href = `${id}.html?${query}`;
  };
  if (flow && pdfs.length) {
    const next = flow.steps[flowStep + 1];
    box.append(next
      ? h('div.flow-next', {},
        h('p', {}, `Paso ${flowStep + 1} de ${flow.steps.length} listo.`),
        h('button.btn.btn-brand.btn-lg', { type: 'button', id: 'flow-next', onclick: () => goTo(next, `continuar=1&flujo=${flow.id}&paso=${flowStep + 1}`) },
          `Siguiente paso: ${toolById(next).name}`, iconEl('arrow-right')))
      : h('p.flow-done', {}, iconEl('check'), h('span', {}, `Terminaste el flujo "${flow.name}".`)));
  }
  if (pdfs.length && !result.final && !flow) {
    const options = CONTINUE_WITH.filter((id) => id !== tool.id).map(toolById).filter(Boolean);
    box.append(h('div.continue', {},
      h('p.continue-title', {}, 'Continuar con este archivo'),
      h('div.continue-list', {}, options.map((t) => h('button.continue-chip', { type: 'button', onclick: () => goTo(t.id) },
        h(`span.tile.sm.cat-${t.cat}`, { html: iconEl(t.icon).outerHTML }), t.name)))));
  }

  box.append(h('div.done-actions', {},
    h('button.btn.btn-ghost', { type: 'button', onclick: () => show(el.work) }, iconEl('undo-2'), 'Volver a editar'),
    h('button.btn.btn-ghost', { type: 'button', onclick: reset }, iconEl('plus'), 'Empezar de nuevo')));

  el.done.querySelector('.done-slot').replaceChildren(box);
  show(el.done);
}

// Archivo que viene de otra herramienta
if (params.get('continuar')) {
  const incoming = await takeHandoff();
  if (incoming.length) {
    history.replaceState(null, '', location.pathname + (flow ? `?flujo=${flow.id}&paso=${flowStep}` : ''));
    await addFiles(incoming);
  }
}
