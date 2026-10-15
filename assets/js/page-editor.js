// Visor de páginas con elementos encima (texto, imágenes, formas, dibujos, recuadros).
// Lo usan Editar PDF, Censurar PDF, Recortar PDF y Formularios PDF.
// Las posiciones se guardan como fracciones (0 a 1) de la página tal como se ve en pantalla.
import { readBytes, openPdfjs, renderPage } from './lib.js';
import { h, iconEl } from './ui.js';

const MIN = 0.01;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * opts: {
 *   tools: [{ id, label, icon, mode: 'select'|'drag'|'click'|'draw', sticky, make(base) -> obj }],
 *   renderObject(obj, el, px) — dibuja el contenido del elemento (px = puntos PDF → píxeles),
 *   onSelect(obj|null), onChange(), lockAspect(obj) -> bool, deletable(obj) -> bool,
 *   onClickTool(tool, point) — para herramientas 'click' que necesitan pedir algo (p. ej. una imagen),
 * }
 */
export async function mountEditor(ctx, opts) {
  const doc = await openPdfjs(await readBytes(ctx.files[0].file));
  const state = { page: 0, tool: opts.tools[0].id, objects: [], selected: null, seq: 0, scale: 1, view: null };

  const prev = h('button.icon-btn', { type: 'button', 'aria-label': 'Página anterior', onclick: () => goTo(state.page - 1) }, iconEl('chevron-left'));
  const next = h('button.icon-btn', { type: 'button', 'aria-label': 'Página siguiente', onclick: () => goTo(state.page + 1) }, iconEl('chevron-right'));
  const counter = h('span.signer-counter', {});
  const canvasSlot = h('div.signer-canvas-slot', {});
  const layer = h('div.editor-layer', {});
  const sheet = h('div.signer-sheet', {}, canvasSlot, layer);
  const stage = h('div.signer-stage', {}, sheet);

  const toolButtons = opts.tools.map((t) => {
    const b = h('button.tool-btn', { type: 'button', title: t.label, 'aria-pressed': String(t.id === state.tool), onclick: () => setTool(t.id) },
      iconEl(t.icon), h('span', {}, t.label));
    b.dataset.tool = t.id;
    return b;
  });
  const palette = opts.tools.length > 1 ? h('div.tool-palette', { role: 'toolbar', 'aria-label': 'Herramientas' }, toolButtons) : null;

  ctx.toolbar.replaceChildren(h('div.signer-nav', {}, prev, counter, next), opts.hint ? h('span.toolbar-hint', {}, opts.hint) : null);
  ctx.area.replaceChildren(...[palette, stage].filter(Boolean));

  function setTool(id) {
    state.tool = id;
    for (const b of toolButtons) b.setAttribute('aria-pressed', String(b.dataset.tool === id));
    layer.dataset.tool = opts.tools.find((t) => t.id === id)?.mode || 'select';
    if (id !== 'select') select(null);
  }

  async function render() {
    const page = await doc.getPage(state.page + 1);
    const base = page.getViewport({ scale: 1 });
    const pad = getComputedStyle(stage);
    const room = stage.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    const cssWidth = Math.floor(Math.min(room, 860));
    state.view = { width: base.width, height: base.height, css: cssWidth };
    state.scale = cssWidth / base.width;
    const canvas = await renderPage(page, state.scale * Math.min(window.devicePixelRatio || 1, 2));
    canvas.className = 'signer-canvas';
    sheet.style.width = `${cssWidth}px`;
    sheet.style.aspectRatio = `${base.width} / ${base.height}`;
    canvasSlot.replaceChildren(canvas);
    counter.textContent = `Página ${state.page + 1} de ${doc.numPages}`;
    prev.disabled = state.page === 0;
    next.disabled = state.page === doc.numPages - 1;
    opts.onPage?.(state.page, canvas);
    drawObjects();
  }

  function goTo(i) {
    if (i < 0 || i >= doc.numPages) return;
    state.page = i;
    select(null);
    render();
  }

  function drawObjects() {
    layer.replaceChildren(...state.objects.filter((o) => o.page === state.page).map(objectEl));
  }

  function changed() { opts.onChange?.(); }

  function select(obj) {
    state.selected = obj;
    for (const el of layer.querySelectorAll('.ed-obj')) el.classList.toggle('is-selected', Number(el.dataset.id) === obj?.id);
    opts.onSelect?.(obj);
  }

  function objectEl(obj) {
    const el = h('div.ed-obj', { dataset: { id: obj.id, type: obj.type } });
    place(el, obj);
    opts.renderObject(obj, el, state.scale);
    if (opts.deletable?.(obj) !== false) {
      el.append(h('button.ed-del', {
        type: 'button', 'aria-label': 'Quitar', title: 'Quitar',
        onclick: (e) => { e.stopPropagation(); remove(obj); },
      }, iconEl('x')));
    }
    if (obj.type !== 'draw') for (const c of ['nw', 'ne', 'sw', 'se']) el.append(h('span.ed-handle', { dataset: { h: c } }));
    el.classList.toggle('is-selected', state.selected?.id === obj.id);
    el.addEventListener('pointerdown', (e) => startDrag(e, obj, el));
    return el;
  }

  function place(el, obj) {
    el.style.left = `${obj.x * 100}%`;
    el.style.top = `${obj.y * 100}%`;
    el.style.width = `${obj.w * 100}%`;
    el.style.height = obj.autoHeight ? 'auto' : `${obj.h * 100}%`;
  }

  function startDrag(e, obj, el) {
    if (e.target.closest('.ed-del')) return;
    const editing = e.target.closest('[contenteditable="true"]');
    if (editing && state.selected?.id === obj.id) return; // deja escribir
    e.stopPropagation();
    if (state.tool !== 'select') setTool('select');
    select(obj);
    e.preventDefault();
    const handle = e.target.closest('.ed-handle')?.dataset.h;
    const rect = layer.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, ox: obj.x, oy: obj.y, ow: obj.w, oh: obj.h };
    const lock = opts.lockAspect?.(obj);
    const ratio = obj.h / obj.w;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / rect.width;
      const dy = (ev.clientY - start.y) / rect.height;
      if (!handle) {
        obj.x = clamp(start.ox + dx, 0, 1 - obj.w);
        obj.y = clamp(start.oy + dy, 0, 1 - (obj.autoHeight ? 0.02 : obj.h));
      } else {
        let { ox: x, oy: y, ow: w, oh: hh } = start;
        if (handle.includes('e')) w = clamp(start.ow + dx, MIN, 1 - x);
        if (handle.includes('s')) hh = clamp(start.oh + dy, MIN, 1 - y);
        if (handle.includes('w')) { const nx = clamp(start.ox + dx, 0, start.ox + start.ow - MIN); w = start.ow + (start.ox - nx); x = nx; }
        if (handle.includes('n')) { const ny = clamp(start.oy + dy, 0, start.oy + start.oh - MIN); hh = start.oh + (start.oy - ny); y = ny; }
        if (lock) {
          hh = w * ratio;
          if (handle.includes('n')) y = start.oy + start.oh - hh;
          if (y < 0 || y + hh > 1) return;
        }
        Object.assign(obj, { x, y, w, h: hh });
      }
      place(el, obj);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      changed();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Crear elementos tocando o arrastrando sobre la página
  layer.addEventListener('pointerdown', (e) => {
    if (e.target !== layer) return;
    const tool = opts.tools.find((t) => t.id === state.tool);
    const rect = layer.getBoundingClientRect();
    const px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const py = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    if (!tool || tool.mode === 'select') { select(null); return; }
    e.preventDefault();

    if (tool.mode === 'click') {
      if (opts.onClickTool) opts.onClickTool(tool, { x: px, y: py });
      else add(tool.make({ x: px, y: py }));
      if (!tool.sticky) setTool('select');
      return;
    }

    layer.setPointerCapture(e.pointerId);
    const ghost = h('div.ed-ghost', {});
    const points = [[px, py]];
    if (tool.mode === 'draw') {
      ghost.classList.add('is-path');
      ghost.innerHTML = `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" stroke-width="4" vector-effect="non-scaling-stroke" points=""/></svg>`;
    }
    layer.append(ghost);
    const poly = ghost.querySelector('polyline');
    let box = { x: px, y: py, w: 0, h: 0 };
    const move = (ev) => {
      const qx = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
      const qy = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
      if (tool.mode === 'draw') {
        points.push([qx, qy]);
        poly.setAttribute('points', points.map(([a, b]) => `${a * 1000},${b * 1000}`).join(' '));
        return;
      }
      box = { x: Math.min(px, qx), y: Math.min(py, qy), w: Math.abs(qx - px), h: Math.abs(qy - py) };
      place(ghost, box);
    };
    const up = () => {
      layer.removeEventListener('pointermove', move);
      layer.removeEventListener('pointerup', up);
      layer.removeEventListener('pointercancel', up);
      ghost.remove();
      if (tool.mode === 'draw') {
        if (points.length > 1) {
          const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
          const x = Math.min(...xs); const y = Math.min(...ys);
          add(tool.make({ x, y, w: Math.max(MIN, Math.max(...xs) - x), h: Math.max(MIN, Math.max(...ys) - y), points }));
        }
      } else if (box.w < 0.015 || box.h < 0.01) {
        add(tool.make({ x: px, y: py }));
      } else {
        add(tool.make({ ...box, sized: true }));
      }
      if (!tool.sticky) setTool('select');
    };
    if (tool.mode === 'drag') place(ghost, box);
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
  });

  document.addEventListener('keydown', onKey);
  function onKey(e) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected && !e.target.closest('input, textarea, [contenteditable="true"]')) {
      if (opts.deletable?.(state.selected) !== false) remove(state.selected);
    }
  }

  function add(obj) {
    if (!obj) return null;
    obj.id = ++state.seq;
    obj.page ??= state.page;
    // Si se creó tocando un punto, centra el tamaño por defecto en ese punto.
    if (!obj.sized && obj.cx != null) {
      obj.x = clamp(obj.cx - obj.w / 2, 0, 1 - obj.w);
      obj.y = clamp(obj.cy - obj.h / 2, 0, 1 - obj.h);
    }
    state.objects.push(obj);
    drawObjects();
    select(obj);
    changed();
    return obj;
  }

  function remove(obj) {
    const i = state.objects.indexOf(obj);
    if (i >= 0) state.objects.splice(i, 1);
    if (state.selected === obj) select(null);
    drawObjects();
    changed();
  }

  function update(obj) {
    const el = layer.querySelector(`.ed-obj[data-id="${obj.id}"]`);
    if (!el) return;
    el.replaceWith(objectEl(obj));
    changed();
  }

  let resizeTimer;
  const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 200); };
  window.addEventListener('resize', onResize);
  setTool(state.tool);

  return {
    doc,
    get numPages() { return doc.numPages; },
    get page() { return state.page; },
    get objects() { return state.objects; },
    get selected() { return state.selected; },
    get scale() { return state.scale; },
    get view() { return state.view; },
    render, goTo, add, remove, update, select, setTool, redraw: drawObjects,
    destroy() {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      doc.destroy();
    },
  };
}

// Convierte un elemento (fracciones de la página visible) al rectángulo en puntos PDF reales.
// Devuelve la esquina inferior izquierda visible ya transformada, más ancho, alto y giro.
export function objectBox(vb, obj, visualToPdf) {
  const w = obj.w * vb.width;
  const hgt = obj.h * vb.height;
  const { x, y } = visualToPdf(vb, obj.x * vb.width, vb.height - (obj.y + obj.h) * vb.height);
  return { x, y, w, h: hgt };
}
