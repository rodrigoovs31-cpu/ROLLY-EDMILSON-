// Controlador común de cada página de herramienta:
// elegir archivos → ajustar opciones → procesar → descargar.
import { toolById } from './tools-data.js';
import { $, h, iconEl, toast } from './ui.js';
import {
  isPdf, isImage, fmtSize, readBytes, openPdfjs, renderThumb, getSortable,
  downloadBlob, zipBlobs, UserError, yieldUI,
} from './lib.js';
import { mountPages } from './pages-view.js';

const tool = toolById(document.body.dataset.tool);
const mod = (await import(`./tools/${tool.module}.js`)).default;

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
};

const ACCEPT = {
  pdf: { attr: 'application/pdf,.pdf', test: isPdf, msg: 'Solo se aceptan archivos PDF.' },
  image: { attr: 'image/*', test: isImage, msg: 'Solo se aceptan imágenes (JPG, PNG, WEBP).' },
  any: { attr: 'application/pdf,.pdf,image/*', test: (f) => isPdf(f) || isImage(f), msg: 'Solo se aceptan PDF o imágenes.' },
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
    if (fraction != null) el.busyBar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
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

$('#pick').addEventListener('click', () => el.input.click());
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

  const fresh = ok.map((file) => ({ id: ++seq, file, name: file.name, size: file.size, kind: isPdf(file) ? 'pdf' : 'image' }));
  if (mod.multiple) ctx.files.push(...fresh);
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
  el.busy.hidden = false;
  ctx.progress(0, mod.busyLabel || 'Procesando…');
  await yieldUI();
  try {
    const result = await mod.run(ctx);
    ctx.progress(1);
    await showDone(result);
  } catch (err) {
    report(err);
  } finally {
    el.busy.hidden = true;
  }
});

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
    box.append(btn, h('p.done-file', {}, `${main.name} · ${fmtSize(main.blob.size)}`));
    if (files.length > 1 && files.length <= 30) {
      box.append(h('details.done-list', {},
        h('summary', {}, 'Descargar archivos por separado'),
        h('ul', {}, files.map((f) => h('li', {},
          h('button.linklike', { type: 'button', onclick: () => downloadBlob(f.blob, f.name) }, f.name),
          h('span', {}, fmtSize(f.blob.size)))))));
    }
  }

  box.append(h('div.done-actions', {},
    h('button.btn.btn-ghost', { type: 'button', onclick: () => show(el.work) }, iconEl('undo-2'), 'Volver a editar'),
    h('button.btn.btn-ghost', { type: 'button', onclick: reset }, iconEl('plus'), 'Empezar de nuevo')));

  el.done.querySelector('.done-slot').replaceChildren(box);
  show(el.done);
}
