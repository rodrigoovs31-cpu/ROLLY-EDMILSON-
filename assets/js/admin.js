// Panel del dueño: crea las llaves, genera códigos Pro y guarda el historial de clientes.
// Todo queda en este navegador. La llave privada nunca se sube a internet.
import { SITE } from './config.js';
import { b64url, verifyCode } from './pro.js';
import { $, h, iconEl, toast } from './ui.js';

const KEYS = 'maus-admin-keys';
const SALES = 'maus-admin-ventas';
const read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const app = $('#admin');

async function createKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))));
  return { privateJwk, publicKey, created: new Date().toISOString() };
}

function download(name, text) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
}

async function makeCode(keys, { name, plan, months }) {
  const until = new Date();
  until.setMonth(until.getMonth() + months);
  const payload = b64url.encode(new TextEncoder().encode(JSON.stringify({ n: name, p: plan, e: until.toISOString().slice(0, 10) })));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(payload)));
  return { code: `MAUS-${payload}.${b64url.encode(sig)}`, until };
}

function render() {
  const keys = read(KEYS, null);
  app.replaceChildren();
  if (!keys) {
    const restore = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    restore.addEventListener('change', async () => {
      try {
        const data = JSON.parse(await restore.files[0].text());
        if (!data.privateJwk || !data.publicKey) throw new Error();
        write(KEYS, data); toast('Llaves restauradas'); render();
      } catch { toast('Ese archivo no es un respaldo de llaves de Maus.', 'error'); }
    });
    app.append(h('section.admin-card', {},
      h('h2', {}, '1. Crea tus llaves'),
      h('p', {}, 'Las llaves firman los códigos Pro que vendes. La llave privada se guarda solo en este navegador: nadie más puede crear códigos válidos.'),
      h('div.admin-actions', {},
        h('button.btn.btn-brand', { type: 'button', onclick: async () => { write(KEYS, await createKeys()); toast('Llaves creadas. Descarga el respaldo.'); render(); } }, iconEl('sparkles'), 'Crear mis llaves'),
        h('button.btn.btn-ghost', { type: 'button', onclick: () => restore.click() }, iconEl('upload'), 'Restaurar desde respaldo')),
      restore));
    return;
  }

  const configured = (SITE.pro?.publicKey || '').replace(/\s+/g, '') === keys.publicKey;
  app.append(h('section.admin-card', {},
    h('h2', {}, '1. Tus llaves'),
    configured
      ? h('p.admin-ok', {}, iconEl('check'), 'Tu web ya usa esta llave. Los códigos que generes funcionarán.')
      : h('div', {},
        h('p.admin-warn', {}, 'Falta un paso: copia la llave pública y pégala en el archivo assets/js/config.js, dentro de pro → publicKey (o envíamela y la pongo).'),
        h('textarea.input.mono#admin-pub', { readonly: true, rows: 3 }, keys.publicKey),
        h('button.btn.btn-ghost.sm', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(keys.publicKey); toast('Llave pública copiada'); } catch { $('#admin-pub').select(); } } }, iconEl('copy'), 'Copiar llave pública')),
    h('div.admin-actions', {},
      h('button.btn.btn-ghost.sm', { type: 'button', onclick: () => download('maus-llaves-respaldo.json', JSON.stringify(keys)) }, iconEl('download'), 'Descargar respaldo de llaves')),
    h('p.field-hint', {}, 'Guarda el respaldo en un lugar seguro (no lo compartas). Si cambias de celular, usa "Restaurar desde respaldo".')));

  const name = h('input.input#adm-name', { type: 'text', placeholder: 'Nombre o celular del cliente' });
  const plan = h('select.input#adm-plan', {}, h('option', { value: 'pro' }, `Pro (${SITE.currency} ${SITE.proPrice}/${SITE.proPeriod})`), h('option', { value: 'equipo' }, `Equipos (${SITE.currency} ${SITE.teamPrice}/${SITE.proPeriod})`));
  const months = h('select.input#adm-months', {}, [1, 3, 6, 12].map((m) => h('option', { value: m }, `${m} ${m === 1 ? 'mes' : 'meses'}`)));
  const result = h('div.admin-result');
  const gen = h('button.btn.btn-brand', {
    type: 'button',
    onclick: async () => {
      if (!name.value.trim()) { toast('Escribe el nombre del cliente.', 'error'); return; }
      const { code, until } = await makeCode(keys, { name: name.value.trim(), plan: plan.value, months: Number(months.value) });
      const ok = await verifyCode(code, keys.publicKey);
      if (!ok) { toast('No se pudo verificar el código. Revisa tus llaves.', 'error'); return; }
      const sales = read(SALES, []);
      sales.unshift({ name: name.value.trim(), plan: plan.value, months: Number(months.value), until: until.toISOString().slice(0, 10), date: new Date().toISOString().slice(0, 10), code });
      write(SALES, sales);
      const site = SITE.url || location.origin;
      const msg = `¡Gracias por tu compra! Este es tu código de ${SITE.name} Pro:\n\n${code}\n\nActívalo aquí: ${site}/index.html#pro\nVálido hasta el ${until.toLocaleDateString('es-PE')}.`;
      result.replaceChildren(
        h('textarea.input.mono#adm-code', { readonly: true, rows: 3 }, code),
        h('div.admin-actions', {},
          h('button.btn.btn-ghost.sm', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(code); toast('Código copiado'); } catch { $('#adm-code').select(); } } }, iconEl('copy'), 'Copiar código'),
          h('a.btn.btn-ghost.sm', { href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, iconEl('message-circle'), 'Enviar por WhatsApp')));
      renderSales();
    },
  }, iconEl('plus'), 'Generar código');
  app.append(h('section.admin-card', {},
    h('h2', {}, '2. Crea un código Pro'),
    h('p', {}, 'Cuando confirmes el pago en tu app de Yape o del banco, genera el código y envíaselo al cliente.'),
    h('div.admin-form', {}, name, plan, months, gen),
    result));

  const salesBox = h('section.admin-card#admin-sales');
  app.append(salesBox);
  function renderSales() {
    const sales = read(SALES, []);
    const now = new Date().toISOString().slice(0, 10);
    const active = sales.filter((s) => s.until >= now).length;
    salesBox.replaceChildren(
      h('h2', {}, '3. Tus clientes'),
      h('p.admin-stats', {}, `${sales.length} ${sales.length === 1 ? 'código vendido' : 'códigos vendidos'} · ${active} activos`),
      sales.length ? h('div.admin-table', {}, h('table', {},
        h('thead', {}, h('tr', {}, ['Fecha', 'Cliente', 'Plan', 'Vence'].map((t) => h('th', {}, t)))),
        h('tbody', {}, sales.map((s) => h('tr', { class: s.until < now ? 'is-expired' : '' },
          h('td', {}, s.date), h('td', {}, s.name), h('td', {}, s.plan === 'equipo' ? 'Equipos' : 'Pro'), h('td', {}, s.until)))))) : h('p.field-hint', {}, 'Aquí aparecerán los códigos que generes.'),
      sales.length ? h('button.btn.btn-ghost.sm', {
        type: 'button',
        onclick: () => {
          const csv = ['fecha,cliente,plan,meses,vence,codigo', ...sales.map((s) => [s.date, `"${s.name.replace(/"/g, '""')}"`, s.plan, s.months, s.until, s.code].join(','))].join('\n');
          const a = h('a', { href: URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv' })), download: 'maus-clientes.csv' });
          document.body.append(a); a.click(); a.remove();
        },
      }, iconEl('download'), 'Descargar lista (Excel)') : null);
  }
  renderSales();
}

if (!crypto?.subtle) app.replaceChildren(h('p', {}, 'Abre esta página con https (en tu web publicada) para usar el panel.'));
else render();
