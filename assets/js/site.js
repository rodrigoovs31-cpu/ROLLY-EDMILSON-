// Datos dinámicos comunes a todas las páginas (WhatsApp, precios, año).
import { SITE, whatsappLink } from './config.js';
import { CATEGORIES } from './tools-data.js';

for (const el of document.querySelectorAll('[data-year]')) el.textContent = new Date().getFullYear();
for (const el of document.querySelectorAll('[data-price]')) el.textContent = `${SITE.currency} ${SITE.proPrice}`;
for (const el of document.querySelectorAll('[data-period]')) el.textContent = `/ ${SITE.proPeriod}`;
for (const el of document.querySelectorAll('[data-pay]')) el.textContent = SITE.paymentMethods.join(' · ');

for (const el of document.querySelectorAll('[data-wa]')) {
  const link = whatsappLink(el.dataset.wa);
  if (link) {
    el.href = link;
    el.target = '_blank';
    el.rel = 'noopener';
    el.hidden = false;
  } else if (el.dataset.waFallback === 'disable') {
    el.removeAttribute('href');
    el.setAttribute('aria-disabled', 'true');
    el.classList.add('is-disabled');
    el.textContent = 'Disponible muy pronto';
  } else {
    el.hidden = true;
  }
}
for (const el of document.querySelectorAll('[data-email]')) {
  if (SITE.email) { el.textContent = SITE.email; el.href = `mailto:${SITE.email}`; el.hidden = false; }
}
for (const [net, url] of Object.entries(SITE.social)) {
  for (const el of document.querySelectorAll(`[data-social="${net}"]`)) {
    if (url) { el.href = url; el.hidden = false; }
  }
}

// Filtros de la portada
const filters = document.querySelector('.filters');
if (filters) {
  const cards = [...document.querySelectorAll('.tools-grid .tool-card')];
  filters.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    for (const c of filters.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(c === chip));
    const cat = chip.dataset.cat;
    for (const card of cards) card.hidden = cat !== 'all' && card.dataset.cat !== cat;
  });
  if (!CATEGORIES.length) filters.hidden = true;
}
