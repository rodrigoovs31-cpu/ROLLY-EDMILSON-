import { loadLib, getPdfLib, readBytes, pdfBlob, baseName, UserError } from '../lib.js';
import { h, field, segmented, iconEl, toast } from '../ui.js';
import { readCertificate, signPdf, SignError } from '../pades.js';
import { passwordInput } from './_password.js';

const REASONS = ['Soy el autor de este documento', 'Doy conformidad a este documento', 'Apruebo este documento', 'Revisado'];
let certBytes = null;
let signer = null;

const fmt = (d) => d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default {
  accept: 'pdf',
  multiple: false,
  view: 'files',
  actionLabel: 'Firmar digitalmente',
  busyLabel: 'Firmando con tu certificado…',

  options(ctx, el) {
    ctx.opts = { password: '', reason: REASONS[0], location: '', label: true, page: 'last', pos: 'br' };
    certBytes = null;
    signer = null;
    const info = h('div.cert-info', {}, h('p.field-hint', {}, 'Aún no eliges tu certificado.'));
    const certInput = h('input#cert-file', { type: 'file', accept: '.p12,.pfx,application/x-pkcs12', hidden: true });
    const certBtn = h('button.btn.btn-ghost.btn-block', { type: 'button', onclick: () => certInput.click() }, iconEl('badge-check'), 'Elegir mi certificado (.pfx o .p12)');
    const check = async () => {
      if (!certBytes || !ctx.opts.password) return;
      try {
        const forge = await loadLib('forge');
        signer = readCertificate(forge, certBytes, ctx.opts.password);
        const now = new Date();
        const expired = signer.notAfter < now;
        info.replaceChildren(h('div.cert-card' + (expired ? '.is-bad' : '.is-ok'), {},
          h('strong', {}, signer.name),
          signer.serial ? h('span', {}, signer.serial) : null,
          signer.organization ? h('span', {}, signer.organization) : null,
          h('span', {}, `Emitido por: ${signer.issuer || 'desconocido'}`),
          h('span', {}, expired ? `Venció el ${fmt(signer.notAfter)}` : `Válido hasta el ${fmt(signer.notAfter)}`)));
        if (expired) toast('Tu certificado está vencido. La firma no será válida.', 'error');
      } catch (err) {
        signer = null;
        info.replaceChildren(h('p.field-status.is-error', {}, err instanceof SignError ? err.message : 'No pudimos leer el certificado.'));
      }
    };
    certInput.addEventListener('change', async () => {
      const f = certInput.files[0];
      if (!f) return;
      certBytes = await readBytes(f);
      certBtn.replaceChildren(iconEl('badge-check'), f.name);
      signer = null;
      info.replaceChildren(h('p.field-hint', {}, 'Escribe la contraseña de tu certificado.'));
      check();
    });
    const pw = passwordInput('cert-pw', 'Contraseña del certificado', (v) => { ctx.opts.password = v; signer = null; });
    pw.querySelector('input').addEventListener('change', check);
    pw.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });

    const reason = h('select.input#sig-reason', { onchange: (e) => { ctx.opts.reason = e.target.value; } }, REASONS.map((r) => h('option', { value: r }, r)));
    const stamp = h('div.stack', {},
      field('Sello visible en', segmented('sig-page', [{ value: 'last', label: 'Última página' }, { value: 'first', label: 'Primera página' }], 'last', (v) => { ctx.opts.page = v; })),
      segmented('sig-pos', [{ value: 'br', label: 'Abajo a la derecha' }, { value: 'bl', label: 'Abajo a la izquierda' }], 'br', (v) => { ctx.opts.pos = v; }));
    el.append(
      field('Certificado digital', h('div.stack', {}, certBtn, certInput, info)),
      field('Contraseña', pw),
      field('Motivo', reason),
      field('Lugar (opcional)', h('input.input#sig-location', { type: 'text', placeholder: 'Ej: Lima, Perú', oninput: (e) => { ctx.opts.location = e.target.value; } })),
      h('label.check', {}, h('input#sig-label', { type: 'checkbox', checked: true, onchange: (e) => { ctx.opts.label = e.target.checked; stamp.hidden = !e.target.checked; } }), 'Poner un sello visible con mis datos'),
      stamp,
      h('p.side-note', {}, 'Tu certificado y tu contraseña nunca salen de tu equipo. La firma usa el estándar de PDF que reconocen Adobe Acrobat y otros lectores. Si un trámite del Estado exige firma digital con tu DNI electrónico, usa ReFirma de RENIEC.'),
    );
  },

  validate(ctx) {
    if (!certBytes) return 'Elige tu certificado digital (.pfx o .p12).';
    if (!ctx.opts.password) return 'Escribe la contraseña de tu certificado.';
    return null;
  },

  async run(ctx) {
    const [forge, PDFLib] = await Promise.all([loadLib('forge'), getPdfLib()]);
    try {
      signer ??= readCertificate(forge, certBytes, ctx.opts.password);
      if (signer.notAfter < new Date()) throw new SignError('expired', `Tu certificado venció el ${fmt(signer.notAfter)}. Renuévalo con tu entidad certificadora.`);
      ctx.progress(0.5, 'Calculando la firma…');
      const bytes = await signPdf({ PDFLib, forge }, await readBytes(ctx.files[0].file), signer, {
        reason: ctx.opts.reason,
        location: ctx.opts.location.trim(),
        label: ctx.opts.label ? { page: ctx.opts.page, pos: ctx.opts.pos } : null,
      });
      return {
        title: 'Documento firmado',
        summary: `Firmado por ${signer.name}. No modifiques el PDF después: cualquier cambio invalida la firma.`,
        files: [{ name: `${baseName(ctx.files[0].name)}-firmado.pdf`, blob: pdfBlob(bytes) }],
        final: true,
      };
    } catch (err) {
      if (err instanceof SignError) throw new UserError(err.message);
      throw err;
    }
  },
};
