import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, baseName, visualBox, visualToPdf, winAnsiSafe, canvasToBlob, freeCanvas } from '../lib.js';
import { h, iconEl, field, toast } from '../ui.js';
import { mountEditor, objectBox } from '../page-editor.js';

const COLORS = ['#16182B', '#E5484D', '#2E6FDB', '#12A182', '#F2762E', '#FFFFFF'];
const HIGHLIGHTS = ['#FFE14D', '#7CF29A', '#FF8AC4', '#7FD3FF'];
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const sizedOr = (b, w, hh) => (b.sized ? { x: b.x, y: b.y, w: b.w, h: b.h, sized: true } : { cx: b.x, cy: b.y, w, h: hh });

let editor;
let panel;
let imageInput;

const TOOLS = [
  { id: 'select', label: 'Mover', icon: 'mouse-pointer-2', mode: 'select' },
  { id: 'text', label: 'Texto', icon: 'type', mode: 'click', make: (b) => ({ type: 'text', text: 'Escribe aquí', size: 14, color: '#16182B', bold: false, autoHeight: true, x: Math.max(0, Math.min(b.x, 0.64)), y: Math.max(0, Math.min(b.y - 0.015, 0.97)), w: 0.36, h: 0.03, sized: true }) },
  { id: 'image', label: 'Imagen', icon: 'image', mode: 'click' },
  { id: 'rect', label: 'Rectángulo', icon: 'square', mode: 'drag', make: (b) => ({ type: 'rect', color: '#E5484D', fill: false, width: 2, ...sizedOr(b, 0.25, 0.1) }) },
  { id: 'ellipse', label: 'Círculo', icon: 'circle', mode: 'drag', make: (b) => ({ type: 'ellipse', color: '#E5484D', fill: false, width: 2, ...sizedOr(b, 0.18, 0.12) }) },
  { id: 'highlight', label: 'Resaltar', icon: 'highlighter', mode: 'drag', sticky: true, make: (b) => ({ type: 'highlight', color: '#FFE14D', ...sizedOr(b, 0.3, 0.025) }) },
  { id: 'whiteout', label: 'Tapar', icon: 'eraser', mode: 'drag', make: (b) => ({ type: 'whiteout', ...sizedOr(b, 0.25, 0.04) }) },
  { id: 'draw', label: 'Dibujar', icon: 'pencil', mode: 'draw', sticky: true, make: (b) => ({ type: 'draw', color: '#2E6FDB', width: 2, ...b, points: b.points.map(([px, py]) => [(px - b.x) / b.w, (py - b.y) / b.h]) }) },
];

function renderObject(obj, el, px) {
  if (obj.type === 'text') {
    const t = h('div.ed-text', { contenteditable: 'true', spellcheck: 'false' });
    t.innerText = obj.text;
    t.style.fontSize = `${obj.size * px}px`;
    t.style.color = obj.color;
    t.style.fontWeight = obj.bold ? '700' : '400';
    t.addEventListener('input', () => { obj.text = t.innerText; });
    t.addEventListener('focus', () => {
      if (obj.text !== 'Escribe aquí') return;
      // Selecciona solo el texto de ejemplo para reemplazarlo al escribir.
      requestAnimationFrame(() => {
        if (t.innerText !== 'Escribe aquí') return;
        const range = document.createRange();
        range.selectNodeContents(t);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    });
    el.append(t);
  } else if (obj.type === 'image') {
    el.append(h('img', { src: obj.url, alt: '', draggable: 'false' }));
  } else if (obj.type === 'rect' || obj.type === 'ellipse') {
    const s = h('div.ed-shape');
    s.style.border = `${Math.max(1, obj.width * px)}px solid ${obj.color}`;
    s.style.background = obj.fill ? obj.color : 'transparent';
    if (obj.type === 'ellipse') s.style.borderRadius = '50%';
    el.append(s);
  } else if (obj.type === 'highlight') {
    el.append(h('div.ed-shape', { style: `background:${obj.color};opacity:.45;mix-blend-mode:multiply` }));
  } else if (obj.type === 'whiteout') {
    el.append(h('div.ed-shape.ed-whiteout'));
  } else if (obj.type === 'draw') {
    el.innerHTML = `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none" class="ed-path"><polyline fill="none" stroke="${obj.color}" stroke-width="${Math.max(1, obj.width * px)}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" points="${obj.points.map(([a, b]) => `${a * 1000},${b * 1000}`).join(' ')}"/></svg>`;
  }
}

function swatches(name, colors, value, onPick) {
  return h('div.swatches.sm', { role: 'radiogroup' }, colors.map((c, i) => [
    h('input', { type: 'radio', name, id: `${name}-${i}`, checked: c === value, onchange: () => onPick(c) }),
    h('label', { for: `${name}-${i}`, title: c, 'aria-label': c, style: `--sw:${c}` }),
  ]).flat());
}

function showProps(obj) {
  if (!panel) return;
  panel.replaceChildren();
  if (!obj) {
    panel.append(h('p.side-text', {}, 'Elige una herramienta arriba de la página y toca o arrastra sobre ella. Toca un elemento para moverlo o cambiarlo.'));
    return;
  }
  const refresh = () => editor.update(obj);
  if (obj.type === 'text') {
    panel.append(
      field('Tamaño de letra', h('select.input#ed-size', { onchange: (e) => { obj.size = Number(e.target.value); refresh(); } },
        [8, 10, 11, 12, 14, 16, 18, 22, 28, 36, 48].map((n) => h('option', { value: n, selected: n === obj.size }, `${n} pt`)))),
      h('label.check', {}, h('input#ed-bold', { type: 'checkbox', checked: obj.bold, onchange: (e) => { obj.bold = e.target.checked; refresh(); } }), 'Negrita'),
      field('Color', swatches('ed-color', COLORS, obj.color, (c) => { obj.color = c; refresh(); })),
      h('p.field-hint', {}, 'Toca el texto otra vez para escribir.'));
  } else if (obj.type === 'rect' || obj.type === 'ellipse' || obj.type === 'draw') {
    panel.append(
      field('Color', swatches('ed-color', COLORS, obj.color, (c) => { obj.color = c; refresh(); })),
      field('Grosor', h('select.input#ed-width', { onchange: (e) => { obj.width = Number(e.target.value); refresh(); } },
        [1, 2, 3, 5, 8].map((n) => h('option', { value: n, selected: n === obj.width }, `${n} pt`)))));
    if (obj.type !== 'draw') {
      panel.append(h('label.check', {}, h('input#ed-fill', { type: 'checkbox', checked: obj.fill, onchange: (e) => { obj.fill = e.target.checked; refresh(); } }), 'Relleno'));
    }
  } else if (obj.type === 'highlight') {
    panel.append(field('Color', swatches('ed-color', HIGHLIGHTS, obj.color, (c) => { obj.color = c; refresh(); })));
  } else {
    panel.append(h('p.side-text', {}, obj.type === 'whiteout' ? 'Este recuadro blanco tapa lo que hay debajo. Úsalo con un texto encima para corregir algo.' : 'Arrastra la imagen para moverla y usa las esquinas para cambiar su tamaño.'));
  }
  panel.append(h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => editor.remove(obj) }, iconEl('trash-2'), 'Quitar este elemento'));
}

async function imageObject(file, point) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { toast('No se pudo abrir esa imagen.', 'error'); return; }
  const canvas = document.createElement('canvas');
  const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * k);
  canvas.height = Math.round(img.naturalHeight * k);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, 'image/png');
  freeCanvas(canvas);
  URL.revokeObjectURL(url);
  const view = editor.view;
  const w = 0.3;
  const hh = (w * view.width * (img.naturalHeight / img.naturalWidth)) / view.height;
  editor.add({ type: 'image', url: URL.createObjectURL(blob), bytes: new Uint8Array(await blob.arrayBuffer()), cx: point.x, cy: point.y, w, h: Math.min(hh, 0.9) });
}

// Parte el texto en líneas que caben en el ancho dado.
function wrap(text, font, size, maxWidth) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(test, size) > maxWidth) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

export default {
  accept: 'pdf',
  multiple: false,
  view: 'custom',
  actionLabel: 'Guardar PDF',
  busyLabel: 'Guardando tus cambios…',

  async mountView(ctx) {
    editor?.destroy();
    imageInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
    let pending = null;
    imageInput.addEventListener('change', () => {
      if (imageInput.files[0] && pending) imageObject(imageInput.files[0], pending);
      imageInput.value = '';
    });
    editor = await mountEditor(ctx, {
      tools: TOOLS,
      hint: 'Elige una herramienta y toca la página',
      renderObject,
      lockAspect: (o) => o.type === 'image',
      onSelect: showProps,
      onClickTool: (tool, point) => {
        if (tool.id === 'image') { pending = point; imageInput.click(); return; }
        editor.add(tool.make(point));
      },
      onChange: () => ctx.setRunEnabled(editor.objects.length > 0, 'Agrega al menos un elemento'),
    });
    ctx.area.append(imageInput);
    ctx.setRunEnabled(false, 'Agrega al menos un elemento');
  },

  async options(ctx, el) {
    panel = h('div.stack#edit-props');
    el.append(panel);
    showProps(null);
    await editor.render();
  },

  validate() {
    return editor.objects.length ? null : 'Agrega al menos un texto, imagen o forma.';
  },

  async run(ctx) {
    const { StandardFonts, rgb, degrees, LineCapStyle, BlendMode } = await getPdfLib();
    const doc = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const fonts = { 0: await doc.embedFont(StandardFonts.Helvetica), 1: await doc.embedFont(StandardFonts.HelveticaBold) };
    const color = (hex) => rgb(...hexToRgb(hex));

    for (const obj of editor.objects) {
      const page = doc.getPage(obj.page);
      const vb = visualBox(page);
      const rotate = degrees(vb.rot);
      if (obj.type === 'text') {
        const font = fonts[obj.bold ? 1 : 0];
        const lines = wrap(winAnsiSafe(font, obj.text), font, obj.size, obj.w * vb.width + obj.size * 0.5);
        const left = obj.x * vb.width;
        const top = vb.height - obj.y * vb.height;
        lines.forEach((line, i) => {
          const { x, y } = visualToPdf(vb, left, top - obj.size * 0.92 - i * obj.size * 1.2);
          page.drawText(line, { x, y, size: obj.size, font, color: color(obj.color), rotate });
        });
      } else if (obj.type === 'image') {
        const img = await doc.embedPng(obj.bytes);
        const b = objectBox(vb, obj, visualToPdf);
        page.drawImage(img, { x: b.x, y: b.y, width: b.w, height: b.h, rotate });
      } else if (obj.type === 'rect' || obj.type === 'whiteout' || obj.type === 'highlight') {
        const b = objectBox(vb, obj, visualToPdf);
        const opts = { x: b.x, y: b.y, width: b.w, height: b.h, rotate };
        if (obj.type === 'whiteout') page.drawRectangle({ ...opts, color: rgb(1, 1, 1) });
        else if (obj.type === 'highlight') page.drawRectangle({ ...opts, color: color(obj.color), opacity: 0.45, blendMode: BlendMode.Multiply });
        else page.drawRectangle({ ...opts, borderColor: color(obj.color), borderWidth: obj.width, color: obj.fill ? color(obj.color) : undefined });
      } else if (obj.type === 'ellipse') {
        const c = visualToPdf(vb, (obj.x + obj.w / 2) * vb.width, vb.height - (obj.y + obj.h / 2) * vb.height);
        let xs = (obj.w * vb.width) / 2;
        let ys = (obj.h * vb.height) / 2;
        if (vb.rot === 90 || vb.rot === 270) [xs, ys] = [ys, xs];
        page.drawEllipse({ x: c.x, y: c.y, xScale: xs, yScale: ys, borderColor: color(obj.color), borderWidth: obj.width, color: obj.fill ? color(obj.color) : undefined });
      } else if (obj.type === 'draw') {
        const pts = obj.points.map(([a, b]) => visualToPdf(vb, (obj.x + a * obj.w) * vb.width, vb.height - (obj.y + b * obj.h) * vb.height));
        for (let i = 1; i < pts.length; i++) {
          page.drawLine({ start: pts[i - 1], end: pts[i], thickness: obj.width, color: color(obj.color), lineCap: LineCapStyle.Round });
        }
      }
    }
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-editado.pdf`, blob: pdfBlob(await doc.save()) }],
      summary: `Guardaste ${editor.objects.length} ${editor.objects.length === 1 ? 'cambio' : 'cambios'} en tu PDF.`,
    };
  },

  reset() {
    editor?.destroy();
    editor = null;
  },
};
