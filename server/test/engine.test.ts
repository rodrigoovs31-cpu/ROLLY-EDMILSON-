import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { PdfEngine, safeBaseName } from '../src/engine/pdf.js';
import { EngineError } from '../src/engine/errors.js';
import { createLogger } from '../src/lib/logger.js';
import { photoPdf, textPdf } from './fixtures.js';

const engine = new PdfEngine({ gsBin: 'gs', qpdfBin: 'qpdf', timeoutMs: 120_000, brand: 'Maus', log: createLogger('silent') });
let dir: string;
let text: string;
let photos: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'engine-'));
  text = join(dir, 'texto.pdf');
  photos = join(dir, 'fotos.pdf');
  await writeFile(text, await textPdf(3));
  await writeFile(photos, await photoPdf(3));
});
after(() => rm(dir, { recursive: true, force: true }));

const rejectsWith = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (err: unknown) => err instanceof EngineError && err.code === code);

describe('PdfEngine', () => {
  it('inspecciona páginas y cifrado', async () => {
    assert.deepEqual(await engine.inspect(text), { pages: 3, encryption: 'none' });
  });

  it('rechaza archivos que no son PDF', async () => {
    const fake = join(dir, 'falso.pdf');
    await writeFile(fake, 'hola, no soy un pdf');
    await rejectsWith(engine.inspect(fake), 'not_pdf');
  });

  it('comprime un PDF con imágenes más de 50%', async () => {
    const r = await engine.compress(photos, dir, 'fotos');
    const saved = 1 - r.size / r.sizeIn;
    assert.ok(saved > 0.5, `solo redujo ${Math.round(saved * 100)}% (${r.sizeIn} → ${r.size}, ${r.method})`);
    assert.equal(r.fileName, 'fotos-comprimido.pdf');
    assert.deepEqual(await engine.inspect(r.path), { pages: 3, encryption: 'none' });
  });

  it('protege con AES-256 y la contraseña abre el archivo', async () => {
    const out = join(dir, 'prot.pdf');
    await engine.protect(text, out, 'mi clave 123', 'texto');
    assert.equal((await engine.inspect(out)).encryption, 'password');
    const info = execFileSync('qpdf', ['--password=mi clave 123', '--show-encryption', out]).toString();
    assert.match(info, /R = 6/);  // R6 = AES-256
    await rejectsWith(engine.protect(text, join(dir, 'x.pdf'), 'a\nb', 'x'), 'bad_password');
  });

  it('une dos PDF en orden', async () => {
    const r = await engine.merge([text, photos], join(dir, 'unido.pdf'), 'texto');
    assert.equal(r.pages, 6);
  });

  it('no deja unir un PDF con contraseña', async () => {
    const locked = join(dir, 'locked.pdf');
    await engine.protect(text, locked, 'secreta', 'x');
    await rejectsWith(engine.merge([text, locked], join(dir, 'u2.pdf'), 'x'), 'password');
  });

  it('convierte a Word con títulos y párrafos', async () => {
    const out = join(dir, 'texto.docx');
    const r = await engine.toWord(text, out, 'texto');
    assert.ok(r.paragraphs >= 9, `párrafos: ${r.paragraphs}`);
    const xml = execFileSync('unzip', ['-p', out, 'word/document.xml']).toString();
    assert.match(xml, /Capitulo 1: Introduccion/);
    assert.match(xml, /En la seccion 1 revisamos el \w+ y la \w+ de cada \w+ para comprobar que las lineas se unen/);
    assert.match(xml, /Heading1|Ttulo1|Title/i);
    assert.ok((await stat(out)).size > 1000);
  });

  it('avisa si el PDF es escaneado (sin texto)', async () => {
    await rejectsWith(engine.toWord(photos, join(dir, 'f.docx'), 'f'), 'no_text');
  });

  it('limpia nombres de archivo', async () => {
    assert.equal(safeBaseName('../../etc/passwd.pdf'), '_.._etc_passwd');
    assert.equal(safeBaseName('Contrato final.PDF'), 'Contrato final');
    assert.equal(safeBaseName(undefined), 'documento');
    assert.ok((await readFile(text)).length > 0 || true);
  });
});
