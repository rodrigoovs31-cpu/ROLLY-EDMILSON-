// DocuMaus Pro sin servidor: códigos firmados con una llave privada que solo tiene el dueño (admin.html).
// La web verifica el código con la llave pública de config.js usando la criptografía del navegador.
import { SITE, whatsappLink } from './config.js';
import { h, iconEl, modal, toast } from './ui.js';

const STORE = 'maus-pro-code';
const PLAN_NAMES = { pro: 'Pro', legal: 'Legal', equipo: 'Estudio' };
export const planName = (plan) => SITE.plans?.[plan]?.name || PLAN_NAMES[plan] || 'Pro';
const planPrice = (plan) => {
  const p = SITE.plans?.[plan];
  return p ? { price: `${p.currency} ${p.price}`, period: p.period } : { price: `${SITE.currency} ${SITE.proPrice}`, period: SITE.proPeriod };
};
const BENEFITS = {
  pro: ['Firma digital con tu certificado (.pfx o .p12)', 'Flujos de trabajo: varias herramientas seguidas', 'Archivos sin límite y OCR de documentos largos', 'Ayuda prioritaria por WhatsApp'],
  legal: ['Armador de expedientes: carátula, índice de anexos y ANEXO 1-A, 1-B…', 'Foliación automática "FOLIO: 001" con sello rojo', 'Finalidad probatoria y resaltado fluorescente de cláusulas', 'Todo lo de Pro: firma digital, flujos y archivos sin límite'],
  equipo: ['Todo lo del plan Legal para hasta 5 personas del estudio', 'Armador de expedientes, foliación e índices sin límite', 'Capacitación por videollamada para tu equipo', 'Atención preferente por WhatsApp'],
};
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

// Ventana para pagar y activar un plan. reason: por qué apareció. plan: 'pro' | 'legal' | 'equipo'.
// extra: { label, onClick } — un botón adicional (por ejemplo, "Probar gratis con marca de agua").
export function openProModal(reason = '', { plan = 'pro', extra = null } = {}) {
  const pay = SITE.payments || {};
  const { price, period } = planPrice(plan);
  const fullName = `${SITE.name} ${planName(plan)}`;
  const wa = whatsappLink(`Hola, quiero ${fullName} (${price} al ${period}). Te envío mi comprobante.`);
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
    h('ul.pro-benefits', {}, (BENEFITS[plan] || BENEFITS.pro).map((t) => h('li', {}, iconEl('check'), h('span', {}, t)))),
    h('p.pro-price', {}, h('strong', {}, price), ` al ${period}`),
    extra ? h('div.pro-try', {}, h('button.btn.btn-ghost#pro-try', { type: 'button', onclick: () => { dlg.close(); extra.onClick(); } }, iconEl('eye'), extra.label),
      h('p.field-hint', {}, 'Ves el resultado completo con una marca de agua. Con el plan lo descargas limpio.')) : null,
    steps,
    h('div.pro-activate', {}, input, activateBtn),
    status,
    plan !== 'pro' ? h('p.field-hint', {}, h('a', { href: 'index.html#planes' }, 'Comparar todos los planes')) : null);
  const dlg = modal({ title: fullName, body });
  activateBtn.addEventListener('click', async () => {
    activateBtn.disabled = true;
    const error = await activate(input.value);
    activateBtn.disabled = false;
    if (error) { status.textContent = error; status.classList.add('is-error'); return; }
    dlg.close();
    toast(`¡Listo! ${planName(state.plan)} activo${state.until ? ` hasta el ${fmtDate(state.until)}` : ''}.`);
  });
  return dlg;
}

// ¿El plan activo incluye esta función? (las de planFeatures solo vienen en ciertos planes)
export function hasFeature(feature) {
  if (!isProFeature(feature)) return true;
  if (!state.active) return false;
  const plans = SITE.pro?.planFeatures?.[feature];
  return !plans || plans.includes(state.plan);
}

// Si el usuario no tiene la función, muestra la ventana del plan que la incluye y devuelve false.
export function requirePro(feature, reason, extra = null) {
  if (hasFeature(feature)) return true;
  openProModal(reason, { plan: SITE.pro?.planFeatures?.[feature]?.[0] || 'pro', extra });
  return false;
}

export function proBadgeText() {
  if (!state.active || state.open) return null;
  return `${planName(state.plan)} activo${state.until ? ` · hasta ${state.until.toLocaleDateString('es-PE')}` : ''}`;
}
