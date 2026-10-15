// Piezas de interfaz reutilizables.
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('div.clase#id', {atributos}, hijos...)
export function h(tag, attrs = {}, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const m of rest.matchAll(/([.#])([\w-]+)/g)) {
    if (m[1] === '.') el.classList.add(m[2]); else el.id = m[2];
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const iconEl = (name, cls) => {
  const span = document.createElement('span');
  span.innerHTML = icon(name, cls);
  return span.firstElementChild;
};

let toastTimer;
export function toast(message, kind = 'info') {
  let el = $('#toast');
  if (!el) {
    el = h('div#toast.toast', { role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3500);
}

// Grupo de opciones tipo "pastillas" (radio). Devuelve el contenedor; el valor está en el input marcado.
export function segmented(name, options, value, onChange) {
  const wrap = h('div.seg', { role: 'radiogroup' });
  for (const opt of options) {
    const id = `${name}-${opt.value}`;
    const input = h('input', { type: 'radio', name, id, value: opt.value, checked: opt.value === value });
    input.addEventListener('change', () => onChange?.(opt.value));
    wrap.append(input, h('label', { for: id }, opt.icon ? iconEl(opt.icon) : null, opt.label));
  }
  return wrap;
}

export function field(label, control, hint) {
  return h('div.field', {}, h('label.field-label', {}, label), control, hint ? h('p.field-hint', {}, hint) : null);
}

export function modal({ title, body, actions = [], onClose }) {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const dialog = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', {},
      h('h2', {}, title),
      h('button.icon-btn', { type: 'button', 'aria-label': 'Cerrar', onclick: close }, iconEl('x'))),
    h('div.modal-body', {}, body),
    actions.length ? h('div.modal-actions', {}, actions) : null);
  const overlay = h('div.modal-overlay', { onclick: (e) => { if (e.target === overlay) close(); } }, dialog);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  dialog.querySelector('input, button:not(.icon-btn)')?.focus();
  return { close, dialog };
}
