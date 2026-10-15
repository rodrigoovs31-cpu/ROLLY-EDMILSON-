import { h, iconEl } from '../ui.js';

// Campo de contraseña con botón para mostrar/ocultar.
export function passwordInput(id, placeholder, onInput) {
  const input = h('input.input', { id, type: 'password', placeholder, autocomplete: 'new-password', oninput: (e) => onInput(e.target.value) });
  const toggle = h('button.icon-btn.sm.pw-toggle', {
    type: 'button', 'aria-label': 'Mostrar contraseña', title: 'Mostrar contraseña',
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.replaceChildren(iconEl(show ? 'eye-off' : 'eye'));
    },
  }, iconEl('eye'));
  return h('div.pw', {}, input, toggle);
}
