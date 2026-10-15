// Campo de rangos sincronizado con las páginas marcadas (eliminar / extraer).
import { parseRanges, rangesToSet, setToRanges } from '../lib.js';
import { h, field } from '../ui.js';

export function rangeField(ctx, label, hint) {
  const input = h('input.input#page-ranges', { type: 'text', placeholder: 'Ej: 2, 5-7', inputmode: 'numeric' });
  const status = h('p.field-status', { 'aria-live': 'polite' });
  input.addEventListener('input', () => {
    const text = input.value.trim();
    if (!text) { ctx.pages.setSelection(new Set()); return; }
    try {
      ctx.pages.setSelection(rangesToSet(parseRanges(text, ctx.pages.numPages)));
      input.classList.remove('is-invalid');
    } catch {
      input.classList.add('is-invalid');
    }
  });
  const sync = () => {
    const set = ctx.pages.selectedNumbers();
    if (document.activeElement !== input) input.value = setToRanges(set);
    status.textContent = set.size ? `${set.size} ${set.size === 1 ? 'página marcada' : 'páginas marcadas'}` : 'Ninguna página marcada';
  };
  return { el: h('div.stack', {}, field(label, input, hint), status), sync };
}
