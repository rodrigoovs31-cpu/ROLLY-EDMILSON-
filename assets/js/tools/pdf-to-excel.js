import { loadLib, baseName, UserError } from '../lib.js';
import { h, field, segmented } from '../ui.js';
import { readLayout, requireText } from '../text-layout.js';

// Convierte "1.234,56", "1,234.56", "S/ 12.50" o "(300)" en número; si no es número, devuelve null.
export function toNumber(raw) {
  let s = raw.trim();
  if (!/^[-+(]?\s*(?:S\/|US\$|\$|€|USD|PEN)?\s*[-+]?[\d.,\s]*\d[\d.,]*\s*%?\)?$/i.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^(S\/|US\$|\$|€|USD|PEN)\s*/i, ''));
  const percent = s.endsWith('%');
  s = s.replace(/[^\d.,]/g, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    s = /,\d{3}$/.test(s) && (s.match(/,/g).length > 1 || s.length > 4) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const v = Number(s);
  if (!Number.isFinite(v) || s === '') return null;
  return (negative ? -v : v) / (percent ? 100 : 1);
}

// Separa una línea en celdas usando los espacios grandes entre fragmentos de texto.
function cellsOf(line) {
  const cells = [];
  let cur = null;
  for (const it of line.items) {
    const gap = cur ? it.x - cur.x1 : Infinity;
    if (cur && gap < Math.max(it.size, 6) * 0.9) {
      cur.text += (gap > it.size * 0.15 ? ' ' : '') + it.str;
      cur.x1 = it.x + it.w;
    } else {
      cur = { text: it.str, x0: it.x, x1: it.x + it.w };
      cells.push(cur);
    }
  }
  return cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
}

// Agrupa las celdas de la página en columnas según cuánto se superponen horizontalmente.
function pageToRows(page) {
  const lines = page.lines.map(cellsOf).filter((c) => c.length);
  const cols = [];
  const multi = lines.filter((c) => c.length > 1).flat();
  for (const c of multi.sort((a, b) => a.x0 - b.x0)) {
    const col = cols.find((k) => Math.min(k.x1, c.x1) - Math.max(k.x0, c.x0) > -4);
    if (col) { col.x0 = Math.min(col.x0, c.x0); col.x1 = Math.max(col.x1, c.x1); } else cols.push({ x0: c.x0, x1: c.x1 });
  }
  cols.sort((a, b) => a.x0 - b.x0);
  // Une columnas que se pisan después de crecer
  for (let i = cols.length - 1; i > 0; i--) {
    if (cols[i].x0 <= cols[i - 1].x1) { cols[i - 1].x1 = Math.max(cols[i - 1].x1, cols[i].x1); cols.splice(i, 1); }
  }
  return lines.map((cells) => {
    if (cells.length === 1 || !cols.length) return [cells.map((c) => c.text).join(' ')];
    const row = Array(cols.length).fill('');
    for (const c of cells) {
      let best = 0, bestOverlap = -Infinity;
      cols.forEach((k, i) => {
        const overlap = Math.min(k.x1, c.x1) - Math.max(k.x0, c.x0);
        if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
      });
      row[best] = row[best] ? `${row[best]} ${c.text}` : c.text;
    }
    return row;
  });
}

export default {
  accept: 'pdf',
  multiple: false,
  view: 'files',
  actionLabel: 'Convertir a Excel',
  busyLabel: 'Buscando tablas…',

  options(ctx, el) {
    ctx.opts = { layout: 'one', numbers: true };
    el.append(
      field('Organización', segmented('xl-layout', [
        { value: 'one', label: 'Todo en una hoja' }, { value: 'pages', label: 'Una hoja por página' },
      ], 'one', (v) => { ctx.opts.layout = v; })),
      h('label.check', {}, h('input#xl-numbers', { type: 'checkbox', checked: true, onchange: (e) => { ctx.opts.numbers = e.target.checked; } }), 'Convertir montos y cantidades en números'),
      h('p.side-note', {}, 'Funciona mejor con PDF generados por sistemas (estados de cuenta, reportes, listas de precios). Si es escaneado, primero usa "OCR PDF".'),
    );
  },

  async run(ctx) {
    const entry = ctx.files[0];
    const layout = await readLayout(entry.file, (f, label) => ctx.progress(f * 0.8, label));
    requireText(layout);
    const XLSX = await loadLib('xlsx');
    const wb = XLSX.utils.book_new();
    const conv = (row) => row.map((v) => (ctx.opts.numbers && toNumber(v) != null ? toNumber(v) : v));
    const sheetOf = (rows) => {
      const ws = XLSX.utils.aoa_to_sheet(rows.map(conv));
      const widths = [];
      for (const r of rows) r.forEach((v, i) => { widths[i] = Math.min(60, Math.max(widths[i] || 6, String(v).length + 2)); });
      ws['!cols'] = widths.map((wch) => ({ wch }));
      return ws;
    };
    const pages = layout.pages.map(pageToRows);
    let rows = 0;
    if (ctx.opts.layout === 'pages') {
      pages.forEach((r, i) => { if (r.length) { XLSX.utils.book_append_sheet(wb, sheetOf(r), `Página ${i + 1}`); rows += r.length; } });
    } else {
      const all = pages.flat();
      rows = all.length;
      XLSX.utils.book_append_sheet(wb, sheetOf(all), 'Datos');
    }
    if (!rows) throw new UserError('No encontramos tablas ni texto para pasar a Excel.');
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return {
      files: [{ name: `${baseName(entry.name)}.xlsx`, blob: new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }],
      summary: `Pasamos ${rows} filas a Excel.`,
    };
  },
};
