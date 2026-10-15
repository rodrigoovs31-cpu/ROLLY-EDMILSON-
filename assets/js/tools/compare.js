import { baseName, UserError, yieldUI } from '../lib.js';
import { h, field } from '../ui.js';
import { readLayout, requireText } from '../text-layout.js';

// Diferencias mínimas entre dos listas (algoritmo de Myers). Devuelve [['=', a], ['-', a], ['+', b], ...].
export function diff(a, b, eq = (x, y) => x === y, maxD = 3000) {
  const n = a.length, m = b.length, max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace = []; // solo se guarda la franja usada en cada paso, para no gastar memoria
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    const off = Math.max(0, max - d - 1);
    trace.push({ off, arr: v.slice(off, max + d + 2) });
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && eq(a[x], b[y])) { x++; y++; }
      v[max + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  const ops = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const { off, arr } = trace[d];
    const at = (i) => arr[i - off];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(max + k - 1) < at(max + k + 1)) ? k + 1 : k - 1;
    const prevX = at(max + prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push(['=', a[--x], b[--y]]); }
    if (x === prevX) ops.push(['+', null, b[--y]]); else ops.push(['-', a[--x], null]);
  }
  while (x > 0 && y > 0) ops.push(['=', a[--x], b[--y]]);
  return ops.reverse();
}

const lineList = (layout) => layout.pages.flatMap((p, pi) => p.lines.map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), page: pi + 1 }))).filter((l) => l.text);
const words = (s) => s.split(/(\s+)/).filter(Boolean);

function wordDiffEls(oldText, newText, norm) {
  const ops = diff(words(oldText), words(newText), (x, y) => norm(x) === norm(y), 3000);
  if (!ops) return [h('del', {}, oldText), ' ', h('ins', {}, newText)];
  // Junta las palabras seguidas con el mismo tipo de cambio en un solo bloque.
  const runs = [];
  for (const [op, a, b] of ops) {
    const text = op === '-' ? a : b;
    const last = runs[runs.length - 1];
    if (last && (last.op === op || (/^\s+$/.test(text) && last.op !== '=' && op === '='))) last.text += text;
    else runs.push({ op, text });
  }
  return runs.map((r) => (r.op === '=' ? r.text : h(r.op === '-' ? 'del' : 'ins', {}, r.text)));
}

function reportHtml(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:15px/1.6 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#16182B}h1{font-size:22px}
.cmp-hunk{border:1px solid #DFE2EC;border-radius:10px;padding:10px 14px;margin:12px 0}.cmp-page{color:#5A5F78;font-size:13px;font-weight:700}
del{background:#FDE8E8;color:#A4161A;text-decoration:line-through}ins{background:#DDF5EA;color:#0B6B43;text-decoration:none}
.cmp-stats{display:flex;gap:16px;flex-wrap:wrap;color:#5A5F78}</style></head><body><h1>${title}</h1>${body}</body></html>`;
}

export default {
  accept: 'pdf',
  multiple: true,
  maxFiles: 2,
  sortable: true,
  view: 'files',
  actionLabel: 'Comparar PDF',
  busyLabel: 'Comparando…',

  options(ctx, el) {
    ctx.opts = { ignoreCase: false };
    el.append(
      h('p.side-text', {}, 'El primer archivo es la versión original y el segundo la nueva. Arrástralos para cambiar el orden.'),
      h('label.check', {}, h('input#cmp-case', { type: 'checkbox', onchange: (e) => { ctx.opts.ignoreCase = e.target.checked; } }), 'Ignorar mayúsculas y minúsculas'),
      field('', h('p.field-hint', {}, 'Se comparan los textos. Los cambios de diseño o de imágenes no se detectan.')),
    );
  },

  onChange(ctx) {
    ctx.setRunEnabled(ctx.files.length === 2, 'Agrega 2 archivos para comparar');
  },

  validate(ctx) {
    return ctx.files.length === 2 ? null : 'Agrega exactamente 2 PDF: el original y la versión nueva.';
  },

  async run(ctx) {
    const [fa, fb] = ctx.files;
    const la = await readLayout(fa.file, (f) => ctx.progress(f * 0.4, `Leyendo ${fa.name}…`));
    const lb = await readLayout(fb.file, (f) => ctx.progress(0.4 + f * 0.4, `Leyendo ${fb.name}…`));
    requireText(la);
    requireText(lb);
    ctx.progress(0.85, 'Buscando diferencias…');
    await yieldUI();
    const norm = (s) => (ctx.opts.ignoreCase ? s.toLowerCase() : s).normalize('NFC');
    const A = lineList(la);
    const B = lineList(lb);
    const ops = diff(A, B, (x, y) => norm(x.text) === norm(y.text), 6000);
    if (!ops) throw new UserError('Los documentos son demasiado distintos para compararlos línea por línea.');

    // Agrupa los cambios en bloques (lo quitado junto a lo agregado) con una línea de contexto.
    const hunks = [];
    let cur = null;
    ops.forEach(([op, a, b], i) => {
      if (op === '=') { cur = null; return; }
      if (!cur) {
        cur = { del: [], ins: [], page: (b || a).page, before: ops[i - 1]?.[2]?.text || '' };
        hunks.push(cur);
      }
      if (op === '-') cur.del.push(a.text); else { cur.ins.push(b.text); cur.page = b.page; }
    });
    let added = 0, removed = 0;
    const blocks = hunks.map((hk) => {
      const oldText = hk.del.join(' ');
      const newText = hk.ins.join(' ');
      const inner = oldText && newText ? wordDiffEls(oldText, newText, norm) : oldText ? [h('del', {}, oldText)] : [h('ins', {}, newText)];
      for (const node of inner) {
        if (node.tagName === 'INS') added += node.textContent.split(/\s+/).filter(Boolean).length;
        if (node.tagName === 'DEL') removed += node.textContent.split(/\s+/).filter(Boolean).length;
      }
      return h('div.cmp-hunk', {}, h('div.cmp-page', {}, `Página ${hk.page} (versión nueva)`), h('p', {}, ...inner));
    });

    const stats = h('div.cmp-stats', {},
      h('span', {}, h('strong', {}, String(hunks.length)), hunks.length === 1 ? ' cambio' : ' cambios'),
      h('span.ins-count', {}, `+${added} palabras`),
      h('span.del-count', {}, `−${removed} palabras`));
    const body = h('div.compare-box', {}, stats, blocks.length ? blocks : h('p', {}, 'No encontramos diferencias de texto.'));
    const title = `Comparación: ${fa.name} → ${fb.name}`;
    const html = reportHtml(title, body.outerHTML);
    return {
      title: hunks.length ? `Encontramos ${hunks.length} ${hunks.length === 1 ? 'cambio' : 'cambios'}` : 'Los textos son iguales',
      summary: hunks.length ? 'En verde lo agregado y en rojo lo eliminado.' : 'No hay diferencias en el texto de los dos documentos.',
      details: body,
      files: [{ name: `comparacion-${baseName(fa.name)}-vs-${baseName(fb.name)}.html`, blob: new Blob([html], { type: 'text/html;charset=utf-8' }) }],
    };
  },
};
