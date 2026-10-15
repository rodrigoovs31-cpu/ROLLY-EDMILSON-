// Armador de expedientes jurídicos y medios probatorios (DocuMaus Legal).
// Escrito principal + anexos reordenables (ANEXO 1-A, 1-B…), finalidad probatoria,
// resaltado fluorescente, carátula, índice de anexos y foliación "FOLIO: 001".
// Todo se arma en el Web Worker (assets/workers/expediente-core.js): nada se sube a internet.
import {
  readBytes, openPdfjs, renderPage, freeCanvas, parseRanges, baseName, fmtSize, getSortable, textSpan,
} from '../lib.js';
import { h, field, segmented, iconEl, toast, modal } from '../ui.js';
import { buildExpediente, anexoLabel } from '../pdf-engine.js';

let ui = null;   // estado de la vista (se recrea en cada mountView)
let seq = 0;

const today = () => new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });
const prettyName = (name) => baseName(name).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function makeItem(entry, extra = {}) {
  return { id: ++seq, entry, total: null, range: '', title: prettyName(entry.name), purpose: '', highlights: {}, ...extra };
}

// Páginas elegidas de un ítem, en el orden escrito ("5, 1-3" → 5, 1, 2, 3), sin repetir.
function pagesOf(item) {
  if (!item.total) return null;
  const text = item.range.trim();
  if (!text) return Array.from({ length: item.total }, (_, i) => i + 1);
  const out = [];
  const seen = new Set();
  for (const [a, b] of parseRanges(text, item.total)) {
    for (let n = a; n <= b; n++) if (!seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
}
const highlightCount = (item) => Object.values(item.highlights).reduce((s, list) => s + list.length, 0);

/* ---------- Resaltado fluorescente ---------- */

async function openHighlighter(item, onDone) {
  let pages;
  try { pages = pagesOf(item); } catch (err) { toast(err.message, 'error'); return; }
  if (!pages?.length) { toast('Este archivo aún se está leyendo. Inténtalo en un momento.'); return; }
  const doc = await openPdfjs(await readBytes(item.entry.file));
  let index = 0;
  let renderToken = 0;

  const counter = h('span.hl-counter', {});
  const canvasSlot = h('div.hl-canvas');
  const layer = h('div.hl-layer', { 'aria-label': 'Arrastra para resaltar' });
  const sheet = h('div.hl-sheet', {}, canvasSlot, layer);
  const search = h('input.input#hl-search', { type: 'search', placeholder: 'Ej: CLÁUSULA QUINTA, penalidad, S/ 1 500', autocomplete: 'off' });
  const searchBtn = h('button.btn.btn-ghost.sm#hl-find', { type: 'button' }, iconEl('search'), 'Resaltar coincidencias');
  const status = h('p.field-hint', { 'aria-live': 'polite' });
  const prev = h('button.icon-btn', { type: 'button', 'aria-label': 'Hoja anterior', onclick: () => go(index - 1) }, iconEl('chevron-left'));
  const next = h('button.icon-btn', { type: 'button', 'aria-label': 'Hoja siguiente', onclick: () => go(index + 1) }, iconEl('chevron-right'));
  const clearBtn = h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => { delete item.highlights[pages[index]]; drawRects(); } }, iconEl('eraser'), 'Borrar los de esta hoja');

  const body = h('div.hl-editor', {},
    h('p.field-hint', {}, 'Arrastra sobre las cláusulas o párrafos importantes para pintarlos de amarillo. Toca un resaltado para quitarlo.'),
    h('div.hl-search', {}, search, searchBtn),
    status,
    h('div.hl-nav', {}, prev, counter, next, clearBtn),
    sheet);
  const dlg = modal({
    title: `Resaltar ${item.label || ''}`.trim(),
    body,
    actions: [h('button.btn.btn-brand#hl-done', { type: 'button', onclick: () => dlg.close() }, iconEl('check'), 'Listo')],
    onClose: () => { renderToken++; doc.destroy(); onDone(); },
  });
  dlg.dialog.classList.add('modal-wide');

  const list = () => (item.highlights[pages[index]] ||= []);

  function drawRects() {
    layer.replaceChildren(...(item.highlights[pages[index]] || []).map((r, i) => {
      const box = h('button.hl-rect', {
        type: 'button', title: 'Quitar resaltado', 'aria-label': 'Quitar resaltado',
        style: `left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`,
        onpointerdown: (e) => e.stopPropagation(),
        onclick: () => { list().splice(i, 1); drawRects(); },
      });
      return box;
    }));
  }

  async function go(i) {
    index = Math.max(0, Math.min(pages.length - 1, i));
    const token = ++renderToken;
    counter.textContent = `Hoja ${pages[index]} · ${index + 1} de ${pages.length}`;
    prev.disabled = index === 0;
    next.disabled = index === pages.length - 1;
    const page = await doc.getPage(pages[index]);
    const vp = page.getViewport({ scale: 1 });
    const width = Math.min(sheet.parentElement.clientWidth || 640, 760);
    const canvas = await renderPage(page, (width / vp.width) * Math.min(window.devicePixelRatio || 1, 2));
    page.cleanup();
    if (token !== renderToken) { freeCanvas(canvas); return; }
    sheet.style.width = `${width}px`;
    sheet.style.aspectRatio = `${vp.width} / ${vp.height}`;
    const old = canvasSlot.firstChild;
    canvasSlot.replaceChildren(canvas);
    if (old) freeCanvas(old);
    drawRects();
  }

  // Arrastrar para crear un resaltado (en fracciones de la hoja visible).
  layer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const box = layer.getBoundingClientRect();
    const sx = (e.clientX - box.left) / box.width;
    const sy = (e.clientY - box.top) / box.height;
    const ghost = h('div.hl-rect.is-drawing');
    layer.append(ghost);
    layer.setPointerCapture(e.pointerId);
    let rect = null;
    const move = (ev) => {
      const x = Math.max(0, Math.min(1, (ev.clientX - box.left) / box.width));
      const y = Math.max(0, Math.min(1, (ev.clientY - box.top) / box.height));
      rect = { x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) };
      Object.assign(ghost.style, { left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` });
    };
    const up = () => {
      layer.removeEventListener('pointermove', move);
      layer.removeEventListener('pointerup', up);
      layer.removeEventListener('pointercancel', up);
      ghost.remove();
      if (rect && rect.w > 0.01 && rect.h > 0.006) list().push(rect);
      drawRects();
    };
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
    e.preventDefault();
  });

  // Buscar un texto en las hojas elegidas y resaltar cada coincidencia.
  async function findAll() {
    const q = norm(search.value.trim());
    if (q.length < 2) { status.textContent = 'Escribe al menos 2 letras.'; return; }
    searchBtn.disabled = true;
    let found = 0;
    try {
      for (const n of pages) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        for (const it of content.items) {
          const text = norm(it.str || '');
          let from = 0;
          while (text && (from = text.indexOf(q, from)) !== -1) {
            const [a, b, c, d, , f] = it.transform;
            const size = Math.hypot(c, d) || Math.hypot(a, b);
            const { x0, x1 } = textSpan(it, from, from + q.length, content.styles);
            const [rx0, ry0, rx1, ry1] = vp.convertToViewportRectangle([x0, f - size * 0.3, x1, f + size * 0.95]);
            (item.highlights[n] ||= []).push({
              x: Math.max(0, Math.min(rx0, rx1) / vp.width - 0.004),
              y: Math.max(0, Math.min(ry0, ry1) / vp.height - 0.002),
              w: Math.abs(rx1 - rx0) / vp.width + 0.008,
              h: Math.abs(ry1 - ry0) / vp.height + 0.004,
            });
            found++;
            from += q.length;
          }
        }
        page.cleanup();
      }
    } finally {
      searchBtn.disabled = false;
    }
    status.textContent = found
      ? `Resaltamos ${found} ${found === 1 ? 'coincidencia' : 'coincidencias'}.`
      : 'No encontramos ese texto. Si el documento es escaneado, arrastra sobre el párrafo (o pásalo antes por "OCR PDF").';
    drawRects();
  }
  searchBtn.addEventListener('click', findAll);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findAll(); } });

  requestAnimationFrame(() => go(0));
}

/* ---------- Vista ---------- */

function labels() {
  const opts = { style: ui.ctx.opts.labelStyle, number: ui.ctx.opts.labelNumber };
  ui.items.forEach((it, i) => { it.label = anexoLabel(i, opts); });
}

function itemCard(item) {
  const badge = h('span.exp-label', {}, item.label);
  const info = h('span.exp-file-meta', {}, fmtSize(item.entry.size));
  const thumb = h('div.exp-thumb', {}, h('span.spinner.sm'));
  const rangeInput = h('input.input.exp-range', { type: 'text', inputmode: 'numeric', placeholder: 'Todas', value: item.range, 'aria-label': `Páginas de ${item.label}` });
  const rangeStatus = h('p.field-hint.exp-range-status', {});
  const hlCount = h('span.exp-hl-count', {});
  const updateRange = () => {
    item.range = rangeInput.value;
    try {
      const list = pagesOf(item);
      rangeInput.classList.remove('is-invalid');
      rangeStatus.textContent = list ? `${list.length} ${list.length === 1 ? 'hoja' : 'hojas'}${item.range.trim() ? '' : ' (todas)'}` : '';
    } catch (err) {
      rangeInput.classList.add('is-invalid');
      rangeStatus.textContent = err.message;
    }
    updateSummary();
  };
  rangeInput.addEventListener('input', updateRange);
  const updateHl = () => {
    const n = highlightCount(item);
    hlCount.textContent = n ? `${n} ${n === 1 ? 'resaltado' : 'resaltados'}` : '';
  };

  const card = h('li.exp-item', { dataset: { id: item.id } },
    h('div.exp-item-head', {},
      h('span.exp-handle', { title: 'Arrastra para ordenar', 'aria-hidden': 'true' }, iconEl('grip-vertical')),
      badge,
      h('span.exp-file', {}, h('span.exp-file-name', { title: item.entry.name }, item.entry.name), info),
      h('span.exp-move', {},
        h('button.icon-btn.sm.exp-up', { type: 'button', title: 'Subir', 'aria-label': `Subir ${item.label}`, onclick: () => move(item, -1) }, iconEl('chevron-up')),
        h('button.icon-btn.sm.exp-down', { type: 'button', title: 'Bajar', 'aria-label': `Bajar ${item.label}`, onclick: () => move(item, 1) }, iconEl('chevron-down'))),
      h('button.icon-btn.sm', { type: 'button', title: 'Quitar anexo', 'aria-label': `Quitar ${item.label}`, onclick: () => removeItem(item) }, iconEl('x'))),
    h('div.exp-item-body', {},
      thumb,
      h('div.exp-fields', {},
        field('Descripción', h('input.input.exp-title', { type: 'text', value: item.title, maxlength: 200, oninput: (e) => { item.title = e.target.value; } })),
        field('Finalidad probatoria', h('textarea.input.exp-purpose', {
          rows: 2, maxlength: 600, placeholder: 'Ej: Acredita la relación contractual y el monto de la renta pactada.',
          oninput: (e) => { item.purpose = e.target.value; },
        }, item.purpose)),
        h('div.exp-row', {},
          field('Páginas a incluir', h('div', {}, rangeInput, rangeStatus)),
          field('Resaltado fluorescente', h('div.exp-hl', {},
            h('button.btn.btn-ghost.sm.exp-hl-btn', { type: 'button', onclick: () => openHighlighter(item, updateHl) }, iconEl('highlighter'), 'Resaltar'),
            hlCount))),
        h('div.exp-actions', {},
          h('button.linklike', { type: 'button', onclick: () => duplicate(item) }, iconEl('copy-plus'), 'Extraer otras páginas como nuevo anexo'),
          ui.main ? null : h('button.linklike', { type: 'button', onclick: () => makeMain(item) }, iconEl('file-text'), 'Es el escrito principal')))));

  item.refresh = () => { badge.textContent = item.label; updateRange(); updateHl(); };
  ui.ctx.info(item.entry).then((meta) => {
    item.total = meta.pages || null;
    if (meta.locked) { card.classList.add('is-error'); info.textContent = 'Tiene contraseña: quítasela con "Desbloquear PDF"'; }
    else if (meta.error) { card.classList.add('is-error'); info.textContent = 'No se puede leer'; }
    else info.textContent = `${meta.pages} ${meta.pages === 1 ? 'página' : 'páginas'} · ${fmtSize(item.entry.size)}`;
    thumb.replaceChildren(cloneCanvas(meta.thumb));
    item.refresh();
  });
  return card;
}

function cloneCanvas(node) {
  if (!(node instanceof HTMLCanvasElement)) return node?.cloneNode?.(true) || h('span');
  const c = document.createElement('canvas');
  c.width = node.width; c.height = node.height;
  c.getContext('2d').drawImage(node, 0, 0);
  return c;
}

function mainCard() {
  const m = ui.main;
  if (!m) {
    return h('div.exp-main-empty', {},
      h('p', {}, 'Sin escrito principal: el expediente tendrá solo los anexos.'),
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => { ui.wantMain = true; ui.ctx.pickFiles(); } }, iconEl('plus'), 'Agregar escrito principal'));
  }
  const info = h('span.exp-file-meta', {}, fmtSize(m.entry.size));
  const thumb = h('div.exp-thumb', {}, h('span.spinner.sm'));
  const rangeInput = h('input.input.exp-range', { type: 'text', inputmode: 'numeric', placeholder: 'Todas', value: m.range, 'aria-label': 'Páginas del escrito principal' });
  const rangeStatus = h('p.field-hint', {});
  const update = () => {
    m.range = rangeInput.value;
    try {
      const list = pagesOf(m);
      rangeInput.classList.remove('is-invalid');
      rangeStatus.textContent = list ? `${list.length} ${list.length === 1 ? 'hoja' : 'hojas'}` : '';
    } catch (err) { rangeInput.classList.add('is-invalid'); rangeStatus.textContent = err.message; }
    updateSummary();
  };
  rangeInput.addEventListener('input', update);
  ui.ctx.info(m.entry).then((meta) => {
    m.total = meta.pages || null;
    info.textContent = meta.locked ? 'Tiene contraseña' : meta.error ? 'No se puede leer' : `${meta.pages} ${meta.pages === 1 ? 'página' : 'páginas'} · ${fmtSize(m.entry.size)}`;
    thumb.replaceChildren(cloneCanvas(meta.thumb));
    update();
  });
  return h('div.exp-item.exp-main-card', {},
    h('div.exp-item-head', {},
      h('span.exp-label.is-main', {}, 'ESCRITO'),
      h('span.exp-file', {}, h('span.exp-file-name', { title: m.entry.name }, m.entry.name), info),
      h('button.btn.btn-ghost.sm', { type: 'button', title: 'Pasarlo a la lista de anexos', onclick: () => demoteMain() }, 'No es el escrito')),
    h('div.exp-item-body', {}, thumb, h('div.exp-fields', {}, field('Páginas a incluir', h('div', {}, rangeInput, rangeStatus)))));
}

let sortable;
async function render() {
  labels();
  const list = h('ol.exp-list#exp-list', {}, ui.items.map(itemCard));
  ui.mainSlot.replaceChildren(mainCard());
  ui.listSlot.replaceChildren(
    ui.items.length ? list : h('p.exp-empty', {}, 'Todavía no agregas medios probatorios.'),
    h('button.btn.btn-ghost#exp-add', { type: 'button', onclick: () => { ui.wantMain = false; ui.ctx.pickFiles(); } }, iconEl('plus'), 'Añadir medios probatorios (PDF)'));
  updateSummary();
  if (ui.items.length > 1) {
    const Sortable = await getSortable();
    sortable?.destroy();
    sortable = Sortable.create(list, {
      animation: 160, handle: '.exp-handle', ghostClass: 'is-ghost',
      onEnd: () => {
        const ids = [...list.querySelectorAll('.exp-item')].map((el) => Number(el.dataset.id));
        ui.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        relabel();
      },
    });
  }
}

// Al reordenar solo cambian las etiquetas (no se vuelve a dibujar nada).
function relabel() {
  labels();
  ui.items.forEach((it) => it.refresh?.());
  updateSummary();
}

// Subir o bajar un anexo (además de arrastrarlo): funciona igual en celular y con teclado.
function move(item, delta) {
  const i = ui.items.indexOf(item);
  const j = i + delta;
  if (j < 0 || j >= ui.items.length) return;
  ui.items.splice(i, 1);
  ui.items.splice(j, 0, item);
  render().then(() => document.querySelector(`.exp-item[data-id="${item.id}"] .${delta < 0 ? 'exp-up' : 'exp-down'}`)?.focus());
}

function removeItem(item) {
  ui.items.splice(ui.items.indexOf(item), 1);
  syncFiles();
  render();
}
function duplicate(item) {
  const copy = makeItem(item.entry, { title: `${item.title} (extracto)`, total: item.total });
  ui.items.splice(ui.items.indexOf(item) + 1, 0, copy);
  render();
  toast('Nuevo anexo con el mismo archivo: escribe qué páginas usar.');
}
function makeMain(item) {
  ui.items.splice(ui.items.indexOf(item), 1);
  ui.main = makeItem(item.entry, { total: item.total });
  render();
}
function demoteMain() {
  ui.items.unshift(makeItem(ui.main.entry, { total: ui.main.total }));
  ui.main = null;
  render();
}
// ctx.files solo guarda los archivos que siguen en uso.
function syncFiles() {
  const used = new Set([ui.main?.entry, ...ui.items.map((i) => i.entry)].filter(Boolean));
  for (let i = ui.ctx.files.length - 1; i >= 0; i--) if (!used.has(ui.ctx.files[i])) ui.ctx.files.splice(i, 1);
}

function updateSummary() {
  if (!ui) return;
  let sheets = 0;
  let ok = true;
  const parts = [ui.main, ...ui.items].filter(Boolean);
  for (const p of parts) {
    try { const l = pagesOf(p); if (l) sheets += l.length; else ok = false; } catch { ok = false; }
  }
  const o = ui.ctx.opts;
  const sep = o.separators ? ui.items.length : 0;
  const front = (o.cover ? 1 : 0) + (o.index && ui.items.length ? 1 : 0);
  const total = sheets + sep + front;
  ui.summary.textContent = parts.length
    ? `${ui.items.length} ${ui.items.length === 1 ? 'anexo' : 'anexos'} · ${ok ? `unas ${total} hojas` : 'leyendo archivos…'}`
    : 'Agrega tus documentos';
  ui.ctx.setRunEnabled(parts.length > 0, 'Agrega al menos un documento');
}

/* ---------- Herramienta ---------- */

export default {
  accept: 'pdf',
  multiple: true,
  view: 'custom',
  preview: true,   // sin el plan Legal se puede probar con marca de agua
  actionLabel: 'Armar expediente',
  busyLabel: 'Armando el expediente…',

  async mountView(ctx) {
    const [first, ...rest] = ctx.files;
    ui = {
      ctx,
      main: first ? makeItem(first) : null,
      items: rest.map((e) => makeItem(e)),
      mainSlot: h('div.exp-main-slot'),
      listSlot: h('div.exp-list-slot'),
      summary: h('span.toolbar-info#exp-summary'),
      wantMain: false,
    };
    ctx.toolbar.replaceChildren(ui.summary, h('span.toolbar-hint', {}, 'Ordena los anexos con las flechas o arrastrándolos: las etiquetas se actualizan solas.'));
    ctx.area.replaceChildren(h('div.exp', {},
      h('section.exp-section', {},
        h('h2.exp-h', {}, h('span.exp-step', {}, '1'), 'Escrito o documento principal'),
        h('p.field-hint', {}, 'Demanda, recurso, contestación, propuesta técnica… Va después de la carátula y el índice.'),
        ui.mainSlot),
      h('section.exp-section', {},
        h('h2.exp-h', {}, h('span.exp-step', {}, '2'), 'Medios probatorios (anexos)'),
        h('p.field-hint', {}, 'Cada archivo es un anexo. Puedes usar solo algunas páginas, explicar qué prueba y resaltar lo importante.'),
        ui.listSlot)));
    await render();
  },

  // Archivos agregados después (botón "Añadir").
  async onFiles(ctx, entries) {
    if (!ui) return;
    if (ui.wantMain && !ui.main && entries.length) {
      ui.main = makeItem(entries.shift());
    }
    ui.wantMain = false;
    ui.items.push(...entries.map((e) => makeItem(e)));
    await render();
  },

  options(ctx, el) {
    const o = ctx.opts = {
      cover: true, court: '', caseNumber: '', matter: '', title: '', sumilla: '', party: '', placeDate: `Lima, ${today()}`,
      index: true, labelStyle: 'letter', labelNumber: 1, separators: false, stampLabels: true,
      folio: true, folioStart: 1, folioOrder: 'asc', folioFront: true, lock: false,
    };
    const text = (key, label, placeholder, attrs = {}) => field(label, h(attrs.rows ? 'textarea.input' : 'input.input', {
      id: `exp-${key}`, type: attrs.rows ? undefined : 'text', placeholder, rows: attrs.rows, maxlength: attrs.max || 200, value: attrs.rows ? undefined : o[key],
      oninput: (e) => { o[key] = e.target.value; },
    }, attrs.rows ? o[key] : null));
    const check = (key, label, onChange) => h('label.check', {}, h('input', {
      id: `exp-${key}`, type: 'checkbox', checked: o[key],
      onchange: (e) => { o[key] = e.target.checked; onChange?.(e.target.checked); updateSummary(); },
    }), label);

    const coverFields = h('div.stack.exp-cover-fields', {},
      text('court', 'Órgano jurisdiccional o entidad', 'Ej: 5.° Juzgado Civil de Lima · Municipalidad de…'),
      text('caseNumber', 'Expediente N.°', 'Ej: 01234-2026-0-1801-JR-CI-05'),
      text('title', 'Título del escrito', 'Ej: Demanda de desalojo · Propuesta técnica'),
      text('sumilla', 'Sumilla', 'Ej: Interpongo demanda y ofrezco medios probatorios', { rows: 2, max: 400 }),
      text('matter', 'Materia / proceso (opcional)', 'Ej: Desalojo por falta de pago'),
      text('party', 'Presentado por', 'Nombre del cliente, abogado o postor'),
      text('placeDate', 'Lugar y fecha', ''));
    const folioFields = h('div.stack', {},
      h('div.row2', {},
        field('Empezar en', h('input.input#exp-folioStart', { type: 'number', min: 1, value: 1, oninput: (e) => { o.folioStart = Math.max(1, Number(e.target.value) || 1); } })),
        field('Orden', segmented('exp-folio-order', [{ value: 'asc', label: 'Primera → última' }, { value: 'desc', label: 'Última → primera' }], 'asc', (v) => { o.folioOrder = v; }))),
      check('folioFront', 'Foliar también la carátula y el índice'));
    const labelNumber = field('Número de anexo', h('input.input#exp-labelNumber', {
      type: 'number', min: 1, value: 1, oninput: (e) => { o.labelNumber = Math.max(1, Number(e.target.value) || 1); relabel(); },
    }));

    el.append(
      h('h3.opt-h', {}, iconEl('scale'), 'Carátula'),
      check('cover', 'Agregar carátula', (on) => { coverFields.hidden = !on; }),
      coverFields,
      h('h3.opt-h', {}, iconEl('list-ordered'), 'Índice y etiquetas'),
      check('index', 'Índice de anexos (anexo, folios y objeto de prueba)'),
      field('Etiquetas', segmented('exp-label-style', [{ value: 'letter', label: 'Anexo 1-A, 1-B…' }, { value: 'number', label: 'Anexo 1, 2, 3…' }], 'letter', (v) => { o.labelStyle = v; relabel(); })),
      labelNumber,
      check('stampLabels', 'Sellar la etiqueta en la primera hoja de cada anexo'),
      check('separators', 'Hoja separadora antes de cada anexo'),
      h('h3.opt-h', {}, iconEl('stamp'), 'Foliación'),
      check('folio', 'Foliar todas las hojas: "FOLIO: 001" arriba a la derecha', (on) => { folioFields.hidden = !on; }),
      folioFields,
      h('h3.opt-h', {}, iconEl('lock'), 'Protección'),
      check('lock', 'Bloquear la edición del PDF (se puede abrir e imprimir)'),
      h('p.side-note', {}, 'Los folios, sellos y resaltados quedan grabados en el contenido de cada hoja. Para que cualquier cambio posterior sea detectable, firma el expediente con "Firma digital" al terminar.'),
    );
  },

  onChange() { updateSummary(); },

  validate(ctx) {
    if (!ui || (!ui.main && !ui.items.length)) return 'Agrega el escrito principal o al menos un medio probatorio.';
    for (const p of [ui.main, ...ui.items].filter(Boolean)) {
      if (!p.total) return `Todavía estamos leyendo "${p.entry.name}" (o no se puede abrir). Espera un momento o quítalo.`;
      try { if (!pagesOf(p).length) return `Elige al menos una página de "${p.entry.name}".`; } catch (err) { return `${p.label || 'Escrito'}: ${err.message}`; }
    }
    return null;
  },

  async run(ctx) {
    const o = ctx.opts;
    const entries = [...new Set([ui.main?.entry, ...ui.items.map((i) => i.entry)].filter(Boolean))];
    const fileIndex = (entry) => entries.indexOf(entry);
    labels();
    const job = {
      main: ui.main ? { file: fileIndex(ui.main.entry), pages: pagesOf(ui.main) } : null,
      anexos: ui.items.map((it) => ({
        file: fileIndex(it.entry), pages: pagesOf(it), label: it.label,
        title: it.title.trim() || prettyName(it.entry.name), purpose: it.purpose.trim(),
        highlights: it.highlights,
      })),
      cover: {
        enabled: o.cover, court: o.court.trim(), caseNumber: o.caseNumber.trim(), matter: o.matter.trim(),
        title: o.title.trim(), sumilla: o.sumilla.trim(), party: o.party.trim(), placeDate: o.placeDate.trim(),
      },
      index: { enabled: o.index },
      separators: o.separators,
      stampLabels: o.stampLabels,
      folio: { enabled: o.folio, start: o.folioStart, order: o.folioOrder, includeFront: o.folioFront },
      lock: o.lock,
      preview: Boolean(ctx.preview),
    };
    const r = await buildExpediente(entries.map((e) => ({ name: e.name, file: e.file })), job, (v, label) => ctx.progress(v, label));
    const name = (o.title.trim() || o.caseNumber.trim() || 'expediente').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
    const rows = [
      r.main ? h('li', {}, h('strong', {}, 'Escrito principal'), h('span', {}, r.main.folios ? `Folios ${r.main.folios}` : `${r.main.sheets} hojas`)) : null,
      ...r.anexos.map((a) => h('li', {}, h('strong', {}, a.label), h('span', {}, a.folios ? `Folios ${a.folios}` : `${a.sheets} hojas`))),
    ];
    return {
      title: ctx.preview ? 'Vista previa lista' : 'Expediente listo',
      summary: `${r.sheets} hojas${o.folio ? ' foliadas' : ''} con ${r.anexos.length} ${r.anexos.length === 1 ? 'anexo' : 'anexos'}.${ctx.preview ? ' Tiene marca de agua: activa DocuMaus Legal para descargarlo limpio.' : ''}`,
      details: h('ul.exp-result', {}, rows),
      files: [{ name: `${name}${ctx.preview ? '-vista-previa' : ''}.pdf`, blob: r.blob }],
      final: Boolean(ctx.preview),   // la vista previa no pasa a otras herramientas
    };
  },

  reset() {
    ui = null;
    sortable?.destroy();
    sortable = null;
  },
};

