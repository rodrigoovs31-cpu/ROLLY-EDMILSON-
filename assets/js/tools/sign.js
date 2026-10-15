import {
  readBytes, openPdfjs, renderPage, loadPdfDoc, getPdfLib, pdfBlob, baseName,
  visualBox, visualToPdf, canvasToBlob, freeCanvas,
} from '../lib.js';
import { h, iconEl, modal, toast, segmented } from '../ui.js';

const FONTS = ['Dancing Script', 'Caveat', 'Great Vibes'];
const INK = [['#16182B', 'Negro'], ['#1D3FB8', 'Azul']];

let state;

function freshState() {
  return { doc: null, pageIndex: 0, signature: null, placements: [], seq: 0, ctx: null, ui: {} };
}

/* ---------- Imagen de la firma ---------- */

// Recorta los bordes transparentes de un canvas y devuelve { url, bytes, w, h }.
async function trimToPng(canvas) {
  const c = canvas.getContext('2d');
  const { width, height } = canvas;
  const data = c.getImageData(0, 0, width, height).data;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await canvasToBlob(out, 'image/png');
  const result = { url: out.toDataURL('image/png'), bytes: new Uint8Array(await blob.arrayBuffer()), w: out.width, h: out.height };
  freeCanvas(out);
  return result;
}

let fontsRequested = false;
function ensureFonts() {
  if (fontsRequested) return;
  fontsRequested = true;
  const families = FONTS.map((f) => `family=${f.replace(/ /g, '+')}`).join('&');
  document.head.append(h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${families}&display=swap` }));
}

async function textToPng(text, font, color, size = 120) {
  try { await document.fonts.load(`${size}px "${font}"`, text); } catch { /* usa la fuente de respaldo */ }
  const canvas = document.createElement('canvas');
  const c = canvas.getContext('2d');
  c.font = `${size}px "${font}", cursive`;
  canvas.width = Math.ceil(c.measureText(text).width + size);
  canvas.height = Math.ceil(size * 1.8);
  c.font = `${size}px "${font}", cursive`;
  c.fillStyle = color;
  c.textBaseline = 'middle';
  c.fillText(text, size / 2, canvas.height / 2);
  return trimToPng(canvas);
}

function drawPad(color) {
  const canvas = h('canvas.sigpad', { width: 1200, height: 400, 'aria-label': 'Área para dibujar la firma' });
  const c = canvas.getContext('2d');
  c.lineCap = 'round';
  c.lineJoin = 'round';
  let last = null;
  let dirty = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    last = pos(e);
    c.beginPath();
    c.fillStyle = color.value;
    c.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
    c.fill();
    dirty = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last) return;
    const p = pos(e);
    c.strokeStyle = color.value;
    c.lineWidth = 7;
    c.beginPath();
    c.moveTo(last.x, last.y);
    c.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
    c.lineTo(p.x, p.y);
    c.stroke();
    last = p;
  });
  const end = () => { last = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {
    canvas,
    clear: () => { c.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    isEmpty: () => !dirty,
  };
}

function openSignatureDialog(onDone) {
  ensureFonts();
  const color = { value: INK[0][0] };
  let tab = 'draw';

  const pad = drawPad(color);
  const drawPane = h('div.sig-pane', {},
    h('div.sigpad-wrap', {}, pad.canvas, h('span.sigpad-line', {})),
    h('button.btn.btn-ghost.sm', { type: 'button', onclick: pad.clear }, iconEl('undo-2'), 'Borrar'));

  const nameInput = h('input.input#sig-name', { type: 'text', placeholder: 'Escribe tu nombre', maxlength: 40 });
  let font = FONTS[0];
  const fontList = h('div.fontpick', { role: 'radiogroup' }, FONTS.map((f, i) => [
    h('input', { type: 'radio', name: 'sig-font', id: `sig-font-${i}`, checked: i === 0, onchange: () => { font = f; } }),
    h('label', { for: `sig-font-${i}`, style: `font-family:"${f}", cursive` }, 'Tu firma'),
  ]).flat());
  nameInput.addEventListener('input', () => {
    for (const l of fontList.querySelectorAll('label')) l.textContent = nameInput.value || 'Tu firma';
  });
  const typePane = h('div.sig-pane', { hidden: true }, nameInput, fontList);

  let uploaded = null;
  const removeBg = h('input#sig-removebg', { type: 'checkbox', checked: true });
  const preview = h('div.sig-upload-preview', {}, 'Ninguna imagen elegida');
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => { uploaded = img; preview.replaceChildren(img); };
    img.onerror = () => toast('No se pudo abrir esa imagen.', 'error');
    img.src = URL.createObjectURL(file);
  });
  const uploadPane = h('div.sig-pane', { hidden: true },
    h('button.btn.btn-ghost', { type: 'button', onclick: () => fileInput.click() }, iconEl('image'), 'Elegir imagen de mi firma'),
    fileInput, preview,
    h('label.check', {}, removeBg, 'Quitar el fondo blanco'));

  const panes = { draw: drawPane, type: typePane, upload: uploadPane };
  const tabs = segmented('sig-tab', [
    { value: 'draw', label: 'Dibujar', icon: 'pen-tool' },
    { value: 'type', label: 'Escribir', icon: 'type' },
    { value: 'upload', label: 'Subir imagen', icon: 'image' },
  ], 'draw', (v) => { tab = v; for (const [k, p] of Object.entries(panes)) p.hidden = k !== v; });

  const inks = h('div.swatches.sm', { role: 'radiogroup', 'aria-label': 'Color de tinta' }, INK.map(([c, name], i) => [
    h('input', { type: 'radio', name: 'sig-ink', id: `sig-ink-${i}`, checked: i === 0, onchange: () => { color.value = c; } }),
    h('label', { for: `sig-ink-${i}`, title: name, 'aria-label': name, style: `--sw:${c}` }),
  ]).flat());

  const use = h('button.btn.btn-brand', { type: 'button' }, iconEl('check'), 'Usar esta firma');
  const dlg = modal({
    title: 'Crea tu firma',
    body: h('div.sig-dialog', {}, tabs, drawPane, typePane, uploadPane, h('div.sig-ink-row', {}, h('span', {}, 'Tinta'), inks)),
    actions: [use],
  });

  use.addEventListener('click', async () => {
    let sig = null;
    if (tab === 'draw') {
      if (pad.isEmpty()) { toast('Dibuja tu firma en el recuadro.', 'error'); return; }
      sig = await trimToPng(pad.canvas);
    } else if (tab === 'type') {
      const text = nameInput.value.trim();
      if (!text) { toast('Escribe tu nombre.', 'error'); return; }
      sig = await textToPng(text, font, color.value);
    } else {
      if (!uploaded) { toast('Elige una imagen de tu firma.', 'error'); return; }
      const k = Math.min(1, 1600 / Math.max(uploaded.naturalWidth, uploaded.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(uploaded.naturalWidth * k);
      canvas.height = Math.round(uploaded.naturalHeight * k);
      const c = canvas.getContext('2d');
      c.drawImage(uploaded, 0, 0, canvas.width, canvas.height);
      if (removeBg.checked) {
        const img = c.getImageData(0, 0, canvas.width, canvas.height);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const light = Math.min(d[i], d[i + 1], d[i + 2]);
          if (light > 200) d[i + 3] = Math.round(d[i + 3] * Math.max(0, (235 - light) / 35));
        }
        c.putImageData(img, 0, 0);
      }
      sig = await trimToPng(canvas);
      freeCanvas(canvas);
    }
    if (!sig) { toast('La firma quedó vacía. Inténtalo otra vez.', 'error'); return; }
    dlg.close();
    onDone(sig);
  });
}

async function dateStamp() {
  const d = new Date();
  const text = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  return textToPng(text, 'Figtree', '#16182B', 64);
}

/* ---------- Visor de páginas con firmas ---------- */

async function renderCurrent() {
  const { ui, doc } = state;
  const page = await doc.getPage(state.pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const pad = getComputedStyle(ui.stage);
  const room = ui.stage.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
  const cssWidth = Math.floor(Math.min(room, 820));
  const scale = (cssWidth / base.width) * Math.min(window.devicePixelRatio || 1, 2);
  const canvas = await renderPage(page, scale);
  canvas.className = 'signer-canvas';
  ui.sheet.style.width = `${cssWidth}px`;
  ui.sheet.style.aspectRatio = `${base.width} / ${base.height}`;
  ui.canvasSlot.replaceChildren(canvas);
  ui.counter.textContent = `Página ${state.pageIndex + 1} de ${doc.numPages}`;
  ui.prev.disabled = state.pageIndex === 0;
  ui.next.disabled = state.pageIndex === doc.numPages - 1;
  drawPlacements();
}

function drawPlacements() {
  const { ui } = state;
  ui.layer.replaceChildren(...state.placements.filter((p) => p.page === state.pageIndex).map(placementEl));
  updateCount();
}

function updateCount() {
  const n = state.placements.length;
  state.ui.count.textContent = n ? `${n} ${n === 1 ? 'firma colocada' : 'firmas colocadas'}` : 'Aún no colocas ninguna firma';
  state.ctx.setRunEnabled(n > 0, 'Coloca tu firma en el documento');
}

function placementEl(p) {
  const box = h('div.sig-box', { style: `left:${p.x * 100}%;top:${p.y * 100}%;width:${p.w * 100}%;height:${p.h * 100}%` },
    h('img', { src: p.sig.url, alt: 'Firma', draggable: 'false' }),
    h('button.sig-del', { type: 'button', 'aria-label': 'Quitar firma', title: 'Quitar' }, iconEl('x')),
    h('span.sig-resize', { 'aria-hidden': 'true' }));
  const apply = () => {
    box.style.left = `${p.x * 100}%`; box.style.top = `${p.y * 100}%`;
    box.style.width = `${p.w * 100}%`; box.style.height = `${p.h * 100}%`;
  };
  box.querySelector('.sig-del').addEventListener('click', (e) => {
    e.stopPropagation();
    state.placements.splice(state.placements.indexOf(p), 1);
    drawPlacements();
  });
  box.addEventListener('click', (e) => e.stopPropagation());
  box.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sig-del')) return;
    e.preventDefault();
    e.stopPropagation();
    const resizing = !!e.target.closest('.sig-resize');
    const rect = state.ui.layer.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, px: p.x, py: p.y, pw: p.w };
    const ratio = p.h / p.w;
    box.setPointerCapture(e.pointerId);
    box.classList.add('is-active');
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / rect.width;
      const dy = (ev.clientY - start.y) / rect.height;
      if (resizing) {
        p.w = Math.min(1 - p.x, Math.max(0.05, start.pw + dx));
        p.h = p.w * ratio;
        if (p.y + p.h > 1) { p.h = 1 - p.y; p.w = p.h / ratio; }
      } else {
        p.x = Math.min(1 - p.w, Math.max(0, start.px + dx));
        p.y = Math.min(1 - p.h, Math.max(0, start.py + dy));
      }
      apply();
    };
    const up = () => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.removeEventListener('pointercancel', up);
      box.classList.remove('is-active');
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
  });
  return box;
}

// Coloca una imagen centrada en (cx, cy), en fracciones de la página visible.
function place(sig, cx = 0.5, cy = 0.75, widthFrac = 0.3) {
  const rect = state.ui.layer.getBoundingClientRect();
  const pageRatio = rect.width / rect.height;
  let w = widthFrac;
  let hFrac = (w * pageRatio) / (sig.w / sig.h);
  if (hFrac > 0.25) { hFrac = 0.25; w = (hFrac * (sig.w / sig.h)) / pageRatio; }
  const p = {
    id: ++state.seq, sig, page: state.pageIndex, w, h: hFrac,
    x: Math.min(1 - w, Math.max(0, cx - w / 2)),
    y: Math.min(1 - hFrac, Math.max(0, cy - hFrac / 2)),
  };
  state.placements.push(p);
  drawPlacements();
}

function setSignature(sig) {
  state.signature = sig;
  const { ui } = state;
  ui.sigPreview.replaceChildren(h('img', { src: sig.url, alt: 'Tu firma' }));
  ui.sigButton.replaceChildren(iconEl('pen-tool'), 'Cambiar firma');
  ui.placeButton.disabled = false;
}

function withSignature(fn) {
  if (state.signature) fn(state.signature);
  else openSignatureDialog((sig) => { setSignature(sig); fn(sig); });
}

export default {
  accept: 'pdf',
  multiple: false,
  view: 'custom',
  actionLabel: 'Firmar PDF',
  busyLabel: 'Firmando tu PDF…',

  async mountView(ctx) {
    state?.doc?.destroy();
    state = freshState();
    state.ctx = ctx;
    state.doc = await openPdfjs(await readBytes(ctx.files[0].file));
    const ui = state.ui;
    ui.prev = h('button.icon-btn', { type: 'button', 'aria-label': 'Página anterior', onclick: () => { state.pageIndex--; renderCurrent(); } }, iconEl('chevron-left'));
    ui.next = h('button.icon-btn', { type: 'button', 'aria-label': 'Página siguiente', onclick: () => { state.pageIndex++; renderCurrent(); } }, iconEl('chevron-right'));
    ui.counter = h('span.signer-counter', {});
    ui.canvasSlot = h('div.signer-canvas-slot', {});
    ui.layer = h('div.signer-layer', {
      onclick: (e) => {
        const r = ui.layer.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width;
        const cy = (e.clientY - r.top) / r.height;
        withSignature((sig) => place(sig, cx, cy));
      },
    });
    ui.sheet = h('div.signer-sheet', {}, ui.canvasSlot, ui.layer);
    ui.stage = h('div.signer-stage', {}, ui.sheet);
    ctx.toolbar.replaceChildren(h('div.signer-nav', {}, ui.prev, ui.counter, ui.next),
      h('span.toolbar-hint', {}, 'Toca la página donde quieres firmar'));
    ctx.area.replaceChildren(ui.stage);

    let resizeTimer;
    state.onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderCurrent, 200); };
    window.addEventListener('resize', state.onResize);
  },

  async options(ctx, el) {
    const ui = state.ui;
    ui.sigPreview = h('div.sig-preview', {}, h('span', {}, 'Aún no creas tu firma'));
    ui.sigButton = h('button.btn.btn-ghost.btn-block', { type: 'button', onclick: () => openSignatureDialog((sig) => setSignature(sig)) }, iconEl('pen-tool'), 'Crear firma');
    ui.placeButton = h('button.btn.btn-ghost.btn-block', { type: 'button', onclick: () => withSignature((sig) => place(sig)) }, iconEl('plus'), 'Poner firma en esta página');
    ui.count = h('p.field-status', { 'aria-live': 'polite' });
    el.append(
      h('div.field', {}, h('span.field-label', {}, 'Tu firma'), ui.sigPreview, ui.sigButton),
      ui.placeButton,
      h('button.btn.btn-ghost.btn-block', { type: 'button', onclick: async () => place(await dateStamp(), 0.75, 0.9, 0.2) }, 'Poner fecha de hoy'),
      ui.count,
      h('p.side-note', {}, 'Arrastra la firma para moverla y usa la esquina para cambiar su tamaño. Es una firma visual (imagen), no una firma digital certificada.'),
    );
    await renderCurrent();
  },

  validate() {
    return state.placements.length ? null : 'Coloca tu firma al menos una vez.';
  },

  async run(ctx) {
    const { degrees } = await getPdfLib();
    const doc = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const embedded = new Map();
    for (const p of state.placements) {
      if (!embedded.has(p.sig)) embedded.set(p.sig, await doc.embedPng(p.sig.bytes));
      const page = doc.getPage(p.page);
      const vb = visualBox(page);
      const w = p.w * vb.width;
      const hgt = p.h * vb.height;
      const { x, y } = visualToPdf(vb, p.x * vb.width, vb.height - (p.y + p.h) * vb.height);
      page.drawImage(embedded.get(p.sig), { x, y, width: w, height: hgt, rotate: degrees(vb.rot) });
    }
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-firmado.pdf`, blob: pdfBlob(await doc.save()) }],
      summary: 'Tu documento firmado está listo.',
    };
  },

  reset() {
    if (!state) return;
    window.removeEventListener('resize', state.onResize);
    state.doc?.destroy();
    state = null;
  },
};
