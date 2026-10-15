import { readBytes, runQpdf, pdfBlob, baseName, UserError } from '../lib.js';
import { h, field } from '../ui.js';
import { passwordInput } from './_password.js';

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Proteger PDF',
  busyLabel: 'Cifrando tu PDF…',

  options(ctx, el) {
    ctx.opts = { pw: '', pw2: '' };
    el.append(
      field('Contraseña', passwordInput('pw-1', 'Escribe una contraseña', (v) => { ctx.opts.pw = v; })),
      field('Repite la contraseña', passwordInput('pw-2', 'Escríbela otra vez', (v) => { ctx.opts.pw2 = v; })),
      h('p.side-note', {}, 'Cifrado AES de 256 bits. Guarda tu contraseña: si la olvidas, nadie podrá abrir el archivo, ni siquiera DocuMaus.'),
    );
  },

  validate(ctx) {
    if (ctx.opts.pw.length < 4) return 'Usa una contraseña de al menos 4 caracteres.';
    if (ctx.opts.pw !== ctx.opts.pw2) return 'Las contraseñas no coinciden.';
    return null;
  },

  async run(ctx) {
    const files = [];
    for (const [i, entry] of ctx.files.entries()) {
      ctx.progress(i / ctx.files.length, `Protegiendo ${entry.name}…`);
      const { code, read } = await runQpdf(
        ['--encrypt', ctx.opts.pw, ctx.opts.pw, '256', '--', '/in.pdf', '/out.pdf'],
        { '/in.pdf': await readBytes(entry.file) });
      const out = read('/out.pdf');
      if (code === 2 || !out) throw new UserError(`No se pudo proteger "${entry.name}". Si ya tiene contraseña, quítala primero con "Desbloquear PDF".`);
      files.push({ name: `${baseName(entry.name)}-protegido.pdf`, blob: pdfBlob(out) });
    }
    return { files, zipName: 'maus-protegidos.zip', summary: 'Tu PDF ahora pide contraseña para abrirse.' };
  },
};
