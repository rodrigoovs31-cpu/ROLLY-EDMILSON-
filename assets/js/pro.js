// Maus Pro sin servidor: códigos firmados con una llave privada que solo tiene el dueño (admin.html).
// La web verifica el código con la llave pública de config.js usando la criptografía del navegador.
import { SITE, whatsappLink } from './config.js';
import { h, iconEl, modal, toast } from './ui.js';

const STORE = 'maus-pro-code';
const PLAN_NAMES = { pro: 'Pro', equipo: 'Equipos' };
let state = { active: false };

export const b64url = {
  encode(bytes) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text) {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

const proEnabled = () => Boolean(SITE.pro?.publicKey);

// Verifica un código "MAUS-<datos>.<firma>" y devuelve sus datos, o null si no es válido.
export async function verifyCode(code, publicKey = SITE.pro?.publicKey) {
  try {
    const m = String(code).trim().match(/^MAUS-([\w-]+)\.([\w-]+)$/);
    if (!m || !publicKey || !crypto?.subtle) return null;
    const key = await crypto.subtle.importKey('spki', b64url.decode(publicKey.replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')),
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64url.decode(m[2]), new TextEncoder().encode(m[1]));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(b64url.decode(m[1])));
    return { name: data.n || '', plan: data.p || 'pro', until: data.e ? new Date(`${data.e}T23:59:59`) : null };
  } catch {
    return null;
  }
}

export async function loadPro() {
  if (!proEnabled()) { state = { active: true, open: true }; return state; }
  let code = null;
  try { code = localStorage.getItem(STORE); } catch { /* sin almacenamiento */ }
  const data = code ? await verifyCode(code) : null;
  state = data && (!data.until || data.until >= new Date()) ? { active: true, ...data } : { active: false, expired: Boolean(data) };
  return state;
}

export const isPro = () => state.active;
export const proState = () => state;
export const isProFeature = (id) => proEnabled() && (SITE.pro?.features || []).includes(id);
export const freeLimit = (key) => (proEnabled() ? SITE.pro?.freeLimits?.[key] ?? Infinity : Infinity);

async function activate(code) {
  const data = await verifyCode(code);
  if (!data) return 'Ese código no es válido. Revisa que lo hayas copiado completo.';
  if (data.until && data.until < new Date()) return 'Ese código ya venció. Escríbenos para renovarlo.';
  try { localStorage.setItem(STORE, code.trim()); } catch { return 'Tu navegador no permite guardar el código (¿modo incógnito?).'; }
  state = { active: true, ...data };
  document.dispatchEvent(new CustomEvent('maus:pro'));
  return null;
}

const fmtDate = (d) => d.toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });

function copyButton(text, label) {
  return h('button.btn.btn-ghost.sm', {
    type: 'button',
    onclick: async () => { try { await navigator.clipboard.writeText(text); toast(`${label} copiado`); } catch { toast(text); } },
  }, iconEl('copy'), 'Copiar');
}

// Ventana para pagar y activar Pro. reason: texto que explica por qué apareció.
export function openProModal(reason = '') {
  const pay = SITE.payments || {};
  const price = `${SITE.currency} ${SITE.proPrice}`;
  const wa = whatsappLink(`Hola, quiero ${SITE.name} Pro (${price} al ${SITE.proPeriod}). Te envío mi comprobante.`);
  const input = h('input.input#pro-code', { type: 'text', placeholder: 'MAUS-…', autocomplete: 'off', spellcheck: 'false' });
  const status = h('p.field-status', { 'aria-live': 'polite' });
  const activateBtn = h('button.btn.btn-brand', { type: 'button' }, iconEl('check'), 'Activar');
  const steps = h('ol.pay-steps', {},
    pay.yape ? h('li', {}, h('div', {},
      h('strong', {}, `Yapea ${price} al `), h('span.mono', {}, pay.yape), ' ', copyButton(pay.yape, 'Número'),
      pay.yapeName ? h('div.field-hint', {}, `A nombre de: ${pay.yapeName}`) : null)) : null,
    pay.cardLink ? h('li', {}, h('a.btn.btn-ghost.sm', { href: pay.cardLink, target: '_blank', rel: 'noopener' }, 'Pagar con tarjeta'), h('span.field-hint', {}, ' (página segura del banco)')) : null,
    h('li', {}, wa ? h('a.btn.btn-ghost.sm', { href: wa, target: '_blank', rel: 'noopener' }, iconEl('message-circle'), 'Envía tu comprobante por WhatsApp') : 'Envíanos tu comprobante', h('span.field-hint', {}, ' y te mandamos tu código.')),
    h('li', {}, 'Pega tu código aquí:'));
  const body = h('div.pro-modal', {},
    reason ? h('p.pro-reason', {}, iconEl('sparkles'), h('span', {}, reason)) : null,
    h('ul.pro-benefits', {},
      ['Firma digital con tu certificado (.pfx o .p12)', 'Flujos de trabajo: varias herramientas seguidas', `Archivos sin límite y OCR de documentos largos`, 'Ayuda prioritaria por WhatsApp']
        .map((t) => h('li', {}, iconEl('check'), h('span', {}, t)))),
    h('p.pro-price', {}, h('strong', {}, price), ` al ${SITE.proPeriod}`),
    steps,
    h('div.pro-activate', {}, input, activateBtn),
    status);
  const dlg = modal({ title: `${SITE.name} Pro`, body });
  activateBtn.addEventListener('click', async () => {
    activateBtn.disabled = true;
    const error = await activate(input.value);
    activateBtn.disabled = false;
    if (error) { status.textContent = error; status.classList.add('is-error'); return; }
    dlg.close();
    toast(`¡Listo! ${PLAN_NAMES[state.plan] || 'Pro'} activo${state.until ? ` hasta el ${fmtDate(state.until)}` : ''}.`);
  });
  return dlg;
}

// Si la función es Pro y el usuario no lo tiene, muestra la ventana y devuelve false.
export function requirePro(feature, reason) {
  if (!isProFeature(feature) || isPro()) return true;
  openProModal(reason);
  return false;
}

export function proBadgeText() {
  if (!state.active || state.open) return null;
  return `${PLAN_NAMES[state.plan] || 'Pro'} activo${state.until ? ` · hasta ${state.until.toLocaleDateString('es-PE')}` : ''}`;
}
