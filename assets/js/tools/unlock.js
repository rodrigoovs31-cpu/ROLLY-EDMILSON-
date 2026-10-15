import { readBytes, runQpdf, pdfBlob, baseName, UserError } from '../lib.js';
import { h, field } from '../ui.js';
import { passwordInput } from './_password.js';

export default {
  accept: 'pdf',
  multiple: true,
  view: 'files',
  actionLabel: 'Desbloquear PDF',
  busyLabel: 'Quitando la protección…',

  options(ctx, el) {
    ctx.opts = { pw: '' };
    el.append(
      field('Contraseña del PDF', passwordInput('unlock-pw', 'Déjala vacía si solo tiene restricciones', (v) => { ctx.opts.pw = v; }),
        'Si el PDF se abre sin contraseña pero no deja imprimir o copiar, déjalo vacío.'),
      h('p.side-note', {}, 'Usa esta herramienta solo con documentos que te pertenecen o que tienes permiso para modificar.'),
    );
  },

  async run(ctx) {
    const files = [];
    let wasOpen = 0;
    for (const [i, entry] of ctx.files.entries()) {
      ctx.progress(i / ctx.files.length, `Desbloqueando ${entry.name}…`);
      const bytes = await readBytes(entry.file);
      const check = await runQpdf(['--is-encrypted', '/in.pdf'], { '/in.pdf': bytes });
      if (check.code !== 0) wasOpen++;
      const args = ['--decrypt'];
      if (ctx.opts.pw) args.push(`--password=${ctx.opts.pw}`);
      const { code, errors, read } = await runQpdf([...args, '/in.pdf', '/out.pdf'], { '/in.pdf': bytes });
      const out = read('/out.pdf');
      if (code === 2 || !out) {
        if (errors.some((e) => /password/i.test(e))) {
          throw new UserError(ctx.opts.pw
            ? `La contraseña de "${entry.name}" no es correcta.`
            : `"${entry.name}" pide contraseña para abrirse. Escríbela en el panel.`);
        }
        throw new UserError(`No pudimos leer "${entry.name}". Puede estar dañado.`);
      }
      files.push({ name: `${baseName(entry.name)}-desbloqueado.pdf`, blob: pdfBlob(out) });
    }
    return {
      files,
      zipName: 'maus-desbloqueados.zip',
      summary: wasOpen === ctx.files.length
        ? 'Tu PDF no tenía protección. Igual te dejamos una copia limpia.'
        : 'Listo: tu PDF ya no tiene contraseña ni restricciones.',
    };
  },
};
