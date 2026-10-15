// Motor PDF del servidor (solo para el canal WhatsApp: la web sigue procesando en el navegador).
// Usa programas probados en producción, cada uno en su propio proceso con tiempo máximo:
//   - qpdf: validar, unir, cifrar (AES-256) y optimizar sin pérdida.
//   - Ghostscript: recomprimir imágenes (lo que más reduce el peso de un PDF).
//   - pdf.js + docx: PDF a Word editable.
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../lib/logger.js';
import { buildDocx } from './docx.js';
import { EngineError } from './errors.js';
import { run, type ExecResult } from './exec.js';
import { readLayout } from './text-layout.js';

export interface EngineOptions {
  gsBin: string;
  qpdfBin: string;
  timeoutMs: number;
  brand: string;
  log: Logger;
}

export interface PdfInfo {
  pages: number;
  // none: sin cifrar; restrictions: solo permisos (se abre sin clave); password: pide clave para abrir
  encryption: 'none' | 'restrictions' | 'password';
}

export interface Output {
  path: string;
  size: number;
  mime: string;
  fileName: string;
  note?: string;
}

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// qpdf: 0 = bien, 3 = bien con advertencias (archivo reparado), 2 = error.
const qpdfOk = (r: ExecResult) => !r.timedOut && (r.code === 0 || r.code === 3);

export class PdfEngine {
  constructor(private readonly o: EngineOptions) {}

  private qpdf(args: string[], input?: string) {
    return run(this.o.qpdfBin, ['--no-warn', ...args], { timeoutMs: this.o.timeoutMs, input });
  }

  private fail(r: ExecResult, what: string): never {
    if (r.timedOut) throw new EngineError('timeout', `${what}: tiempo agotado`);
    if (/invalid password/i.test(r.stderr)) throw new EngineError('password');
    this.o.log.warn({ code: r.code, stderr: r.stderr.slice(0, 500) }, `${what} falló`);
    throw new EngineError(/damaged|not a PDF|can't find PDF header|unable to find trailer/i.test(r.stderr) ? 'damaged' : 'failed');
  }

  // Comprueba que sea un PDF real (cabecera %PDF-) y si tiene contraseña.
  async inspect(file: string): Promise<PdfInfo> {
    const fh = await open(file, 'r');
    try {
      const head = Buffer.alloc(1024);
      const { bytesRead } = await fh.read(head, 0, 1024, 0);
      if (!head.subarray(0, bytesRead).toString('latin1').includes('%PDF-')) throw new EngineError('not_pdf');
    } finally {
      await fh.close();
    }
    const enc = await this.qpdf(['--requires-password', file]);
    if (enc.timedOut) throw new EngineError('timeout');
    if (enc.code === 0) return { pages: 0, encryption: 'password' };
    const pages = await this.qpdf(['--show-npages', file]);
    if (!qpdfOk(pages)) this.fail(pages, 'inspect');
    const n = Number.parseInt(pages.stdout.trim(), 10);
    if (!Number.isFinite(n) || n < 1) throw new EngineError('damaged');
    return { pages: n, encryption: enc.code === 3 ? 'restrictions' : 'none' };
  }

  // Comprime: prueba varias estrategias y se queda con el archivo más liviano.
  // Ghostscript /ebook reduce las imágenes a 150 ppp (calidad de pantalla e impresión casera):
  // en escaneos y PDF con fotos suele bajar entre 50% y 80%; en PDF de solo texto, mucho menos.
  async compress(input: string, workDir: string, baseName: string): Promise<Output & { sizeIn: number; method: string }> {
    const sizeIn = (await stat(input)).size;
    const candidates: Array<{ path: string; method: string }> = [{ path: input, method: 'original' }];

    const lossless = join(workDir, 'c-lossless.pdf');
    const q = await this.qpdf(['--decrypt', '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', input, lossless]);
    if (qpdfOk(q)) candidates.push({ path: lossless, method: 'qpdf' });
    else if (q.timedOut) throw new EngineError('timeout');

    const gsOut = join(workDir, 'c-gs.pdf');
    const gs = await run(this.o.gsBin, [
      '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.6', '-dPDFSETTINGS=/ebook',
      '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true',
      '-dAutoRotatePages=/None', '-dColorImageDownsampleThreshold=1.1',
      `-sOutputFile=${gsOut}`, input,
    ], { timeoutMs: this.o.timeoutMs });
    if (gs.code === 0 && !gs.timedOut) {
      const gsq = join(workDir, 'c-gs-q.pdf');
      const r = await this.qpdf(['--object-streams=generate', '--compress-streams=y', gsOut, gsq]);
      candidates.push(qpdfOk(r) ? { path: gsq, method: 'ghostscript+qpdf' } : { path: gsOut, method: 'ghostscript' });
    } else {
      this.o.log.warn({ code: gs.code, timedOut: gs.timedOut, stderr: gs.stderr.slice(0, 300) }, 'ghostscript no pudo comprimir; uso qpdf');
    }

    let best = { path: input, method: 'original', size: sizeIn };
    for (const c of candidates) {
      const size = (await stat(c.path)).size;
      if (size < best.size) best = { ...c, size };
    }
    return {
      path: best.path, size: best.size, sizeIn, method: best.method, mime: PDF_MIME,
      fileName: `${baseName}-comprimido.pdf`,
      note: best.method === 'original' ? 'already_optimized' : undefined,
    };
  }

  // Cifra con AES-256. La contraseña viaja por stdin (nunca en la línea de comandos).
  async protect(input: string, output: string, password: string, baseName: string): Promise<Output> {
    if (/[\r\n]/.test(password) || password.length < 4 || password.length > 64) throw new EngineError('bad_password');
    const args = ['--no-warn', '--encrypt', `--user-password=${password}`, `--owner-password=${password}`, '--bits=256', '--', input, output];
    const r = await run(this.o.qpdfBin, ['@-'], { timeoutMs: this.o.timeoutMs, input: args.join('\n') + '\n' });
    if (!qpdfOk(r)) this.fail(r, 'protect');
    return { path: output, size: (await stat(output)).size, mime: PDF_MIME, fileName: `${baseName}-protegido.pdf` };
  }

  // Une los PDF en el orden recibido. qpdf conserva enlaces, marcadores y formularios.
  async merge(inputs: string[], output: string, baseName: string): Promise<Output & { pages: number }> {
    const r = await this.qpdf(['--empty', '--object-streams=generate', '--pages', ...inputs, '--', output]);
    if (!qpdfOk(r)) this.fail(r, 'merge');
    const pages = await this.qpdf(['--show-npages', output]);
    return {
      path: output, size: (await stat(output)).size, mime: PDF_MIME,
      fileName: `${baseName}-unido.pdf`, pages: Number.parseInt(pages.stdout, 10) || 0,
    };
  }

  // PDF a Word editable. Si el PDF es escaneado (sin texto), avisa para usar OCR.
  async toWord(input: string, output: string, baseName: string): Promise<Output & { paragraphs: number }> {
    // pdf.js no abre PDF con restricciones de forma fiable: primero se quitan con qpdf.
    const plain = join(output + '.plain.pdf');
    const d = await this.qpdf(['--decrypt', input, plain]);
    const source = qpdfOk(d) ? plain : input;
    try {
      const layout = await readLayout(new Uint8Array(await readFile(source)));
      if (layout.words < 5) throw new EngineError('no_text');
      const buffer = await buildDocx(layout.pages, { title: baseName, creator: this.o.brand });
      await writeFile(output, buffer);
      return {
        path: output, size: buffer.length, mime: DOCX_MIME, fileName: `${baseName}.docx`,
        paragraphs: layout.pages.reduce((s, p) => s + p.paragraphs.length, 0),
      };
    } finally {
      await rm(plain, { force: true });
    }
  }

  // Comprueba que qpdf y Ghostscript estén instalados (para /api/health).
  async selfCheck(): Promise<{ qpdf: string | null; gs: string | null }> {
    const version = async (bin: string, arg: string) => {
      try {
        const r = await run(bin, [arg], { timeoutMs: 5000 });
        return r.code === 0 ? (r.stdout.split('\n')[0] ?? '').trim() : null;
      } catch {
        return null;
      }
    };
    return { qpdf: await version(this.o.qpdfBin, '--version'), gs: await version(this.o.gsBin, '--version') };
  }
}

// Nombre de archivo seguro (sin rutas ni caracteres raros) y sin extensión.
export function safeBaseName(name: string | undefined): string {
  const base = (name ?? '').replace(/\.[^.]{1,5}$/, '').normalize('NFC');
  const cleaned = base.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '_').replace(/^[.\s]+/, '').trim().slice(0, 80);
  return cleaned || 'documento';
}
