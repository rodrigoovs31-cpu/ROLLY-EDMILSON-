import { loadLib, readBytes, pdfBlob, baseName, UserError } from '../lib.js';
import { field, segmented, h } from '../ui.js';

// Quita filas y columnas vacías al final de la hoja.
function trimRows(rows) {
  const clean = rows.map((r) => r.map((v) => (v == null ? '' : String(v))));
  while (clean.length && clean[clean.length - 1].every((v) => !v.trim())) clean.pop();
  let cols = 0;
  for (const r of clean) for (let i = r.length - 1; i >= 0; i--) if (r[i].trim()) { cols = Math.max(cols, i + 1); break; }
  return clean.map((r) => Array.from({ length: cols }, (_, i) => r[i] ?? ''));
}

export default {
  accept: 'sheet',
  multiple: true,
  view: 'files',
  actionLabel: 'Convertir a PDF',
  busyLabel: 'Leyendo tu hoja de cálculo…',

  options(ctx, el) {
    ctx.opts = { sheets: 'all', header: true, orientation: 'auto', size: 'a4' };
    el.append(
      field('Hojas', segmented('xl-sheets', [{ value: 'all', label: 'Todas' }, { value: 'first', label: 'Solo la primera' }], 'all', (v) => { ctx.opts.sheets = v; })),
      field('Orientación', segmented('xl-orient', [
        { value: 'auto', label: 'Automática' }, { value: 'portrait', label: 'Vertical' }, { value: 'landscape', label: 'Horizontal' },
      ], 'auto', (v) => { ctx.opts.orientation = v; })),
      field('Tamaño', segmented('xl-size', [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Carta' }], 'a4', (v) => { ctx.opts.size = v; })),
      h('label.check', {}, h('input#xl-header', { type: 'checkbox', checked: true, onchange: (e) => { ctx.opts.header = e.target.checked; } }), 'La primera fila es el encabezado (se repite en cada página)'),
    );
  },

  async run(ctx) {
    const XLSX = await loadLib('xlsx');
    await loadLib('autotable');
    const { jsPDF } = window.jspdf;
    const files = [];
    for (const [fi, entry] of ctx.files.entries()) {
      ctx.progress(fi / ctx.files.length, `Leyendo ${entry.name}…`);
      let wb;
      try { wb = XLSX.read(await readBytes(entry.file), { type: 'array', cellDates: true }); } catch {
        throw new UserError(`No pudimos leer "${entry.name}". Revisa que sea una hoja de cálculo válida.`);
      }
      const names = ctx.opts.sheets === 'first' ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
      const sheets = names.map((name) => ({ name, rows: trimRows(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' })) }))
        .filter((s) => s.rows.length);
      if (!sheets.length) throw new UserError(`"${entry.name}" no tiene datos.`);

      const orient = (s) => (ctx.opts.orientation !== 'auto' ? ctx.opts.orientation : (s.rows[0].length > 6 ? 'landscape' : 'portrait'));
      const doc = new jsPDF({ orientation: orient(sheets[0]), unit: 'pt', format: ctx.opts.size });
      sheets.forEach((s, i) => {
        if (i > 0) doc.addPage(ctx.opts.size, orient(s));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(s.name, 36, 40);
        const cols = s.rows[0].length;
        const head = ctx.opts.header ? [s.rows[0]] : undefined;
        const body = ctx.opts.header ? s.rows.slice(1) : s.rows;
        doc.autoTable({
          head, body, startY: 54, margin: { left: 36, right: 36, top: 36, bottom: 36 },
          theme: 'grid',
          styles: { font: 'helvetica', fontSize: cols > 12 ? 6 : cols > 8 ? 7 : 8.5, cellPadding: 3, overflow: 'linebreak', textColor: [22, 24, 43], lineColor: [210, 214, 226], lineWidth: 0.5 },
          headStyles: { fillColor: [22, 24, 43], textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [246, 247, 251] },
        });
      });
      files.push({ name: `${baseName(entry.name)}.pdf`, blob: pdfBlob(doc.output('arraybuffer')) });
    }
    return { files, zipName: 'maus-excel-a-pdf.zip', summary: files.length === 1 ? 'Tu hoja de cálculo ya es PDF.' : `Convertiste ${files.length} archivos a PDF.` };
  },
};
