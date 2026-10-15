import { loadPdfDoc, readBytes, getPdfLib, pdfBlob, baseName, visualBox, visualToPdf, winAnsiSafe } from '../lib.js';
import { h, field } from '../ui.js';
import { mountEditor } from '../page-editor.js';

let editor;
let existing = [];
const values = new Map();
const sizedOr = (b, w, hh) => (b.sized ? { x: b.x, y: b.y, w: b.w, h: b.h, sized: true } : { cx: b.x, cy: b.y, w, h: hh });

const TOOLS = [
  { id: 'select', label: 'Mover', icon: 'mouse-pointer-2', mode: 'select' },
  { id: 'textfield', label: 'Campo de texto', icon: 'text-cursor-input', mode: 'drag', make: (b) => ({ type: 'textfield', ...sizedOr(b, 0.35, 0.03) }) },
  { id: 'checkbox', label: 'Casilla', icon: 'square-check', mode: 'click', make: (b) => ({ type: 'checkbox', cx: b.x, cy: b.y, w: 0.03, h: 0.022 }) },
];

let kinds = [];
const typeOf = (f) => kinds.find(([C]) => f instanceof C)?.[1] || 'Other';

function fieldInput(f) {
  const name = f.getName();
  const kind = typeOf(f);
  const id = `ff-${name.replace(/[^\w-]/g, '_')}`;
  if (kind === 'TextField') {
    const current = f.getText() || '';
    values.set(name, current);
    const multi = f.isMultiline?.();
    const input = h(multi ? 'textarea.input' : 'input.input', { id, rows: multi ? 3 : null, oninput: (e) => values.set(name, e.target.value) });
    input.value = current;
    return field(name, input);
  }
  if (kind === 'CheckBox') {
    values.set(name, f.isChecked());
    return h('label.check', {}, h('input', { id, type: 'checkbox', checked: f.isChecked(), onchange: (e) => values.set(name, e.target.checked) }), name);
  }
  if (kind === 'Dropdown' || kind === 'OptionList' || kind === 'RadioGroup') {
    const opts = f.getOptions();
    const sel = (f.getSelected?.() || [])[0] ?? '';
    values.set(name, sel);
    return field(name, h('select.input', { id, onchange: (e) => values.set(name, e.target.value) },
      h('option', { value: '' }, '—'), opts.map((o) => h('option', { value: o, selected: o === sel }, o))));
  }
  return null;
}

export default {
  accept: 'pdf',
  multiple: false,
  view: 'custom',
  actionLabel: 'Guardar formulario',
  busyLabel: 'Guardando el formulario…',

  async mountView(ctx) {
    editor?.destroy();
    values.clear();
    const lib = await getPdfLib();
    kinds = [[lib.PDFTextField, 'TextField'], [lib.PDFCheckBox, 'CheckBox'], [lib.PDFDropdown, 'Dropdown'], [lib.PDFOptionList, 'OptionList'], [lib.PDFRadioGroup, 'RadioGroup']];
    const doc = await loadPdfDoc(await readBytes(ctx.files[0].file));
    existing = doc.getForm().getFields().filter((f) => ['TextField', 'CheckBox', 'Dropdown', 'OptionList', 'RadioGroup'].includes(typeOf(f)));
    editor = await mountEditor(ctx, {
      tools: TOOLS,
      hint: existing.length ? 'Rellena los campos en el panel o dibuja campos nuevos' : 'Dibuja campos de texto o casillas sobre la página',
      renderObject: (obj, el) => el.append(h(`div.ed-field.${obj.type}`, {}, obj.type === 'textfield' ? 'Campo de texto' : '')),
      lockAspect: (o) => o.type === 'checkbox',
    });
  },

  async options(ctx, el) {
    ctx.opts = { flatten: false };
    if (existing.length) {
      el.append(h('p.field-status', {}, `Este PDF tiene ${existing.length} ${existing.length === 1 ? 'campo' : 'campos'} para rellenar:`));
      el.append(h('div.stack.form-fields', {}, existing.map(fieldInput).filter(Boolean)));
    } else {
      el.append(h('p.side-text', {}, 'Este PDF no tiene campos. Elige "Campo de texto" o "Casilla" arriba de la página y dibújalos donde quieras que la gente escriba o marque.'));
    }
    el.append(
      h('label.check', {}, h('input#forms-flatten', { type: 'checkbox', onchange: (e) => { ctx.opts.flatten = e.target.checked; } }), 'Aplanar: dejar el texto fijo (ya no se podrá editar)'),
    );
    await editor.render();
  },

  async run(ctx) {
    const { StandardFonts, degrees, rgb } = await getPdfLib();
    const doc = await loadPdfDoc(await readBytes(ctx.files[0].file));
    const form = doc.getForm();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    let filled = 0;
    for (const f of form.getFields()) {
      const name = f.getName();
      if (!values.has(name)) continue;
      const v = values.get(name);
      const kind = typeOf(f);
      try {
        if (kind === 'TextField') { f.setText(winAnsiSafe(font, String(v))); if (v) filled++; }
        else if (kind === 'CheckBox') { v ? f.check() : f.uncheck(); if (v) filled++; }
        else if (v) { f.select(v); filled++; }
      } catch { /* un campo con un valor no válido se deja como estaba */ }
    }
    let created = 0;
    for (const obj of editor.objects) {
      const page = doc.getPage(obj.page);
      const vb = visualBox(page);
      const a = visualToPdf(vb, obj.x * vb.width, vb.height - obj.y * vb.height);
      const b = visualToPdf(vb, (obj.x + obj.w) * vb.width, vb.height - (obj.y + obj.h) * vb.height);
      const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), rotate: degrees(vb.rot), borderColor: rgb(0.6, 0.62, 0.7), borderWidth: 1 };
      created++;
      if (obj.type === 'textfield') {
        const tf = form.createTextField(`Campo ${created}`);
        tf.addToPage(page, { ...rect, font });
      } else {
        form.createCheckBox(`Casilla ${created}`).addToPage(page, rect);
      }
    }
    form.updateFieldAppearances(font);
    if (ctx.opts.flatten) form.flatten();
    const parts = [];
    if (filled) parts.push(`rellenaste ${filled} ${filled === 1 ? 'campo' : 'campos'}`);
    if (created) parts.push(`creaste ${created} ${created === 1 ? 'campo nuevo' : 'campos nuevos'}`);
    return {
      files: [{ name: `${baseName(ctx.files[0].name)}-formulario.pdf`, blob: pdfBlob(await doc.save()) }],
      summary: parts.length ? `Listo: ${parts.join(' y ')}.` : 'Guardamos tu formulario.',
    };
  },

  reset() {
    editor?.destroy();
    editor = null;
  },
};
