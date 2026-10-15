// Vista de páginas en miniatura: ordenar, girar, eliminar o seleccionar.
import { h, iconEl } from './ui.js';
import { openPdfjs, readBytes, renderThumb, getSortable } from './lib.js';

/**
 * cfg: { rotate, remove, reorder, select: null | 'delete' | 'keep', onChange }
 */
export async function mountPages(area, entry, cfg) {
  const bytes = await readBytes(entry.file);
  const doc = await openPdfjs(bytes);
  const pages = [];
  const grid = h('div.pgrid');
  area.replaceChildren(grid);

  const changed = () => cfg.onChange?.();

  const observer = new IntersectionObserver((items) => {
    for (const it of items) {
      if (!it.isIntersecting) continue;
      observer.unobserve(it.target);
      const p = pages.find((x) => x.el === it.target);
      if (p) drawThumb(p);
    }
  }, { rootMargin: '400px' });

  async function drawThumb(p) {
    try {
      const page = await doc.getPage(p.index + 1);
      const canvas = await renderThumb(page, 150);
      p.el.querySelector('.pthumb-inner').replaceChildren(canvas);
    } catch {
      p.el.querySelector('.pthumb-inner').replaceChildren(iconEl('file-x'));
    }
  }

  function paint(p) {
    p.el.querySelector('.pthumb-inner').style.transform = `rotate(${p.rotation}deg)`;
    p.el.classList.toggle('is-selected', !!p.selected);
    p.el.classList.toggle('mode-delete', cfg.select === 'delete');
    p.el.classList.toggle('mode-keep', cfg.select === 'keep');
    p.el.setAttribute('aria-pressed', cfg.select ? String(!!p.selected) : null);
  }

  for (let i = 0; i < doc.numPages; i++) {
    const p = { index: i, rotation: 0, selected: false, el: null };
    const actions = h('div.pactions', {},
      cfg.rotate ? h('button.icon-btn.sm', {
        type: 'button', title: 'Girar a la derecha', 'aria-label': `Girar página ${i + 1}`,
        onclick: (e) => { e.stopPropagation(); p.rotation = (p.rotation + 90) % 360; paint(p); changed(); },
      }, iconEl('rotate-cw')) : null,
      cfg.remove ? h('button.icon-btn.sm.danger', {
        type: 'button', title: 'Eliminar página', 'aria-label': `Eliminar página ${i + 1}`,
        onclick: (e) => { e.stopPropagation(); p.el.remove(); pages.splice(pages.indexOf(p), 1); changed(); },
      }, iconEl('trash-2')) : null,
    );
    p.el = h('div.pcard', { dataset: { index: i }, tabindex: cfg.select ? 0 : null, role: cfg.select ? 'button' : null },
      h('div.pthumb', {}, h('div.pthumb-inner', {}, h('span.spinner.sm'))),
      h('div.pmark', {}, iconEl(cfg.select === 'delete' ? 'x' : 'check')),
      h('span.pnum', {}, i + 1),
      actions.childElementCount ? actions : null);
    if (cfg.select) {
      const toggle = () => { p.selected = !p.selected; paint(p); changed(); };
      p.el.addEventListener('click', toggle);
      p.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    } else if (cfg.rotate && !cfg.remove) {
      p.el.addEventListener('click', () => { p.rotation = (p.rotation + 90) % 360; paint(p); changed(); });
      p.el.classList.add('clickable');
    }
    pages.push(p);
    grid.append(p.el);
    paint(p);
    observer.observe(p.el);
  }

  if (cfg.reorder) {
    const Sortable = await getSortable();
    Sortable.create(grid, {
      animation: 160,
      filter: '.icon-btn',
      preventOnFilter: false,
      delay: 120,
      delayOnTouchOnly: true,
      ghostClass: 'is-ghost',
      onEnd: () => {
        const order = [...grid.children].map((el) => Number(el.dataset.index));
        pages.sort((a, b) => order.indexOf(a.index) - order.indexOf(b.index));
        changed();
      },
    });
  }

  return {
    doc,
    numPages: doc.numPages,
    pages,
    rotateAll(delta) {
      for (const p of pages) { p.rotation = (p.rotation + delta + 360) % 360; paint(p); }
      changed();
    },
    setSelection(set) {
      for (const p of pages) { p.selected = set.has(p.index + 1); paint(p); }
      changed();
    },
    selectedNumbers() {
      return new Set(pages.filter((p) => p.selected).map((p) => p.index + 1));
    },
    destroy() {
      observer.disconnect();
      doc.destroy();
    },
  };
}
