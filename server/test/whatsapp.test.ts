// Prueba de punta a punta: webhook firmado → PostgreSQL → motor PDF → Graph API (simulada).
// Necesita una base de datos de prueba:  TEST_DATABASE_URL=postgres://... npm test
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrate } from '../src/db/migrate.js';
import { createLogger } from '../src/lib/logger.js';
import { signBody } from '../src/whatsapp/signature.js';
import { photoPdf, textPdf } from './fixtures.js';
import { startMockGraph } from './mock-graph.js';

const DB_URL = process.env.TEST_DATABASE_URL;
const TOKEN = 'test-access-token-123';
const SECRET = 'test-app-secret-456';
const VERIFY = 'mi-token-de-verificacion';
const PHONE_ID = '1234567890';
const ADMIN = 'a'.repeat(40);
const CLIENT = '51987654321';

describe('WhatsApp de punta a punta', { skip: !DB_URL && 'define TEST_DATABASE_URL para correr esta prueba' }, () => {
  let graph: Awaited<ReturnType<typeof startMockGraph>>;
  let db: pg.Pool;
  let server: Server;
  let url: string;
  let dataDir: string;
  let ctx: ReturnType<typeof createApp>;
  let n = 0;

  before(async () => {
    graph = await startMockGraph(TOKEN, PHONE_ID);
    dataDir = await mkdtemp(join(tmpdir(), 'rolly-data-'));
    db = new pg.Pool({ connectionString: DB_URL, max: 5 });
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    const cfg = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: DB_URL!, META_VERIFY_TOKEN: VERIFY, META_ACCESS_TOKEN: TOKEN,
      META_APP_SECRET: SECRET, PHONE_NUMBER_ID: PHONE_ID, META_GRAPH_URL: graph.base, ADMIN_API_TOKEN: ADMIN,
      SITE_URL: 'https://documaus.pe', DATA_DIR: dataDir, FREE_MONTHLY_QUOTA: '5', SUPPORT_WHATSAPP: '51974000000',
    });
    ctx = createApp(cfg, db, createLogger('silent'));
    server = ctx.app.listen(0);
    await new Promise((r) => server.once('listening', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    // Con "?." para que un fallo en before() no deje el proceso colgado.
    await ctx?.queue.stop();
    server?.close();
    await graph?.close();
    await db?.end();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  beforeEach(() => graph.clear());

  // Envía un webhook firmado como lo haría Meta y espera a que se procese.
  async function deliver(message: Record<string, unknown>, opts: { sign?: string | null; raw?: string } = {}) {
    const body = opts.raw ?? JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA', changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '51900000000', phone_number_id: PHONE_ID },
            contacts: [{ wa_id: CLIENT, profile: { name: 'Cliente' } }],
            messages: [{ from: CLIENT, id: `wamid.in.${++n}`, timestamp: String(Math.floor(Date.now() / 1000) + n), ...message }],
          },
        }],
      }],
    });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const sig = opts.sign === undefined ? signBody(body, SECRET) : opts.sign;
    if (sig) headers['x-hub-signature-256'] = sig;
    const res = await fetch(`${url}/webhook/whatsapp`, { method: 'POST', headers, body });
    ctx.queue.kick();
    await ctx.queue.drain();
    return res;
  }

  const sendPdf = (bytes: Uint8Array, filename = 'informe.pdf') =>
    deliver({ type: 'document', document: { id: graph.addMedia(bytes), mime_type: 'application/pdf', filename } });
  const choose = (id: string) => deliver({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: id } } });
  const text = (body: string) => deliver({ type: 'text', text: { body } });
  const lastDocument = () => {
    const doc = graph.messages().find((m) => m.type === 'document');
    assert.ok(doc, `no se envió ningún documento. Mensajes: ${JSON.stringify(graph.messages())}`);
    const up = graph.uploads.get(doc.document.id);
    assert.ok(up, 'el documento enviado no corresponde a un archivo subido');
    return { doc, up };
  };
  const texts = () => graph.messages().filter((m) => m.type === 'text').map((m) => m.text.body as string);

  it('GET: responde el hub.challenge solo con el token correcto', async () => {
    const ok = await fetch(`${url}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '1158201444');
    const bad = await fetch(`${url}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1`);
    assert.equal(bad.status, 403);
  });

  it('POST: rechaza firmas inválidas o ausentes', async () => {
    assert.equal((await deliver({ type: 'text', text: { body: 'hola' } }, { sign: null })).status, 401);
    assert.equal((await deliver({ type: 'text', text: { body: 'hola' } }, { sign: 'sha256=' + '0'.repeat(64) })).status, 401);
    assert.equal((await deliver({}, { raw: '{"object":', sign: signBody('{"object":', SECRET) })).status, 400);
    assert.equal(graph.messages().length, 0);
  });

  it('saluda y explica cómo usarlo', async () => {
    const res = await text('hola');
    assert.equal(res.status, 200);
    const [msg] = texts();
    assert.match(msg!, /Envíame un \*PDF como documento\*/);
    assert.match(msg!, /usaste 0 de 5/);
    assert.ok(graph.sent.some((m) => m.status === 'read'), 'debe marcar el mensaje como leído');
  });

  it('PDF → lista de 4 acciones → comprimir → devuelve el PDF más liviano', async () => {
    const original = await photoPdf(2);
    await sendPdf(original, 'escaneo.pdf');
    const list = graph.messages().find((m) => m.type === 'interactive');
    assert.ok(list, 'debe enviar la lista');
    const rows = list.interactive.action.sections[0].rows as Array<{ id: string; title: string }>;
    assert.deepEqual(rows.map((r) => r.id), ['compress', 'protect', 'word', 'merge']);
    for (const r of rows) assert.ok(Array.from(r.title).length <= 24, `título muy largo: ${r.title}`);
    assert.ok(Array.from(list.interactive.action.button as string).length <= 20);
    assert.match(list.interactive.body.text, /escaneo\.pdf/);

    graph.clear();
    await choose('compress');
    console.log('DEBUG', JSON.stringify(graph.messages()).slice(0, 1500));
    assert.match(texts()[0]!, /Comprimiendo/);
    const { doc, up } = lastDocument();
    assert.equal(doc.to, CLIENT);
    assert.equal(up.fileName, 'escaneo-comprimido.pdf');
    assert.equal(up.mime, 'application/pdf');
    assert.ok(up.bytes.length < original.length * 0.5, `${original.length} → ${up.bytes.length}`);
    assert.match(doc.document.caption, /PDF comprimido: .* → \*.*\* \(−\d+%\)/);

    const { rows: [s] } = await db.query('SELECT * FROM whatsapp_sessions ORDER BY created_at DESC LIMIT 1');
    assert.equal(s.status, 'DELIVERED');
    assert.equal(s.action_requested, 'compress');
    const { rows: [job] } = await db.query("SELECT * FROM pdf_jobs WHERE delivery_channel = 'whatsapp' ORDER BY created_at DESC LIMIT 1");
    assert.equal(job.action, 'comprimir');
    assert.equal(Number(job.file_size_out), up.bytes.length);
    const { rows: [sub] } = await db.query('SELECT * FROM subscriptions WHERE phone_number = $1', [CLIENT]);
    assert.equal(sub.used_quota, 1);
    assert.deepEqual(await readdir(dataDir), [], 'los archivos temporales deben borrarse');
  });

  it('ignora los reintentos de Meta (mismo wamid)', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: PHONE_ID },
        messages: [{ from: CLIENT, id: 'wamid.duplicado', timestamp: '1700000000', type: 'text', text: { body: 'hola' } }] } }] }],
    });
    await deliver({}, { raw: body });
    await deliver({}, { raw: body });
    assert.equal(texts().length, 1);
  });

  it('proteger: pide la contraseña, cifra con AES-256 y no la guarda', async () => {
    await sendPdf(await textPdf(2), 'contrato.pdf');
    await text('2');
    assert.match(texts().at(-1)!, /Escribe la \*contraseña\*/);
    await text('ab');  // muy corta
    assert.match(texts().at(-1)!, /entre 4 y 64/);
    graph.clear();
    await text('Lima 2026 segura');
    const { up } = lastDocument();
    assert.equal(up.fileName, 'contrato-protegido.pdf');
    const file = join(dataDir, '..', `prot-${Date.now()}.pdf`);
    await writeFile(file, up.bytes);
    try {
      assert.throws(() => execFileSync('qpdf', ['--show-npages', file], { stdio: 'pipe' }), 'sin contraseña no debe abrir');
      assert.equal(execFileSync('qpdf', ['--password=Lima 2026 segura', '--show-npages', file]).toString().trim(), '2');
    } finally {
      await rm(file, { force: true });
    }
    const leaked = await db.query("SELECT 1 FROM whatsapp_events WHERE payload::text LIKE '%Lima 2026%'");
    assert.equal(leaked.rowCount, 0, 'la contraseña no debe quedar en la base de datos');
  });

  it('convertir a Word: devuelve un .docx editable', async () => {
    await sendPdf(await textPdf(3), 'reporte.pdf');
    graph.clear();
    await text('3');
    const { up, doc } = lastDocument();
    assert.equal(up.fileName, 'reporte.docx');
    assert.equal(up.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(up.bytes.subarray(0, 2).toString(), 'PK');
    assert.match(doc.document.caption, /Word editable/);
  });

  it('Word con PDF escaneado: explica que use OCR', async () => {
    await sendPdf(await photoPdf(1), 'foto.pdf');
    graph.clear();
    await choose('word');
    assert.match(texts().at(-1)!, /escaneado.*\n\n.*ocr-pdf\.html/s);
    const { rows: [s] } = await db.query('SELECT status, error_code FROM whatsapp_sessions ORDER BY created_at DESC LIMIT 1');
    assert.deepEqual(s, { status: 'FAILED', error_code: 'no_text' });
  });

  it('unir: espera el segundo PDF y devuelve uno solo', async () => {
    await sendPdf(await textPdf(2), 'parte1.pdf');
    await choose('merge');
    assert.match(texts().at(-1)!, /envíame el \*otro PDF\*/);
    graph.clear();
    await sendPdf(await textPdf(3), 'parte2.pdf');
    const { up, doc } = lastDocument();
    assert.equal(up.fileName, 'parte1-unido.pdf');
    assert.match(doc.document.caption, /PDF de 5 páginas/);
  });

  it('rechaza PDF con contraseña y archivos que no son PDF', async () => {
    await deliver({ type: 'document', document: { id: graph.addMedia(Buffer.from('JFIF'), 'image/jpeg'), mime_type: 'image/jpeg', filename: 'foto.jpg' } });
    assert.match(texts().at(-1)!, /trabajo solo con \*PDF\*/);
    const dir = await mkdtemp(join(tmpdir(), 'enc-'));
    try {
      await writeFile(join(dir, 'a.pdf'), await textPdf(1));
      execFileSync('qpdf', ['--encrypt', 'x1234', 'x1234', '256', '--', join(dir, 'a.pdf'), join(dir, 'b.pdf')]);
      const { readFile } = await import('node:fs/promises');
      await sendPdf(await readFile(join(dir, 'b.pdf')), 'bloqueado.pdf');
      assert.match(texts().at(-1)!, /tiene contraseña de apertura/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('cancelar borra el archivo pendiente', async () => {
    await sendPdf(await textPdf(1));
    await text('cancelar');
    assert.match(texts().at(-1)!, /cancelé la operación/);
    assert.deepEqual(await readdir(dataDir), []);
  });

  it('cupo agotado: ofrece Pro y no procesa', async () => {
    await db.query('UPDATE subscriptions SET used_quota = monthly_quota WHERE phone_number = $1', [CLIENT]);
    await sendPdf(await textPdf(1));
    assert.match(texts().at(-1)!, /Llegaste al límite de \*5 documentos\*/);
    assert.equal(graph.messages().filter((m) => m.type === 'interactive').length, 0);
    await text('PRO');
    assert.match(texts().at(-1)!, /wa\.me\/51974000000/);
  });

  it('admin: activa Pro WhatsApp con token y lo rechaza sin token', async () => {
    const noAuth = await fetch(`${url}/api/admin/stats`);
    assert.equal(noAuth.status, 401);
    const res = await fetch(`${url}/api/admin/subscriptions/pro`, {
      method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ phone_number: '+51 987 654 321', months: 1 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { subscription: { plan: string; monthly_quota: number }; notified: boolean };
    assert.equal(body.subscription.plan, 'PRO_WHATSAPP');
    assert.equal(body.subscription.monthly_quota, 500);
    assert.equal(body.notified, true);
    assert.match(texts().at(-1)!, /Pro WhatsApp\* está activo/);

    graph.clear();
    await sendPdf(await textPdf(1));
    assert.ok(graph.messages().some((m) => m.type === 'interactive'), 'con Pro debe volver a procesar');

    const stats = await fetch(`${url}/api/admin/stats?days=7`, { headers: { authorization: `Bearer ${ADMIN}` } });
    const json = await stats.json() as { jobs: unknown[] };
    assert.ok(json.jobs.length > 0);
  });

  it('API: salud y estadísticas anónimas de la web', async () => {
    const health = await fetch(`${url}/api/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as { db: boolean }).db, true);
    const ok = await fetch(`${url}/api/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unir-pdf', file_size_in: 1000, file_size_out: 900, processing_time_ms: 120 }),
    });
    assert.equal(ok.status, 204);
    const bad = await fetch(`${url}/api/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: "x'; drop table" }),
    });
    assert.equal(bad.status, 400);
    const { rows } = await db.query("SELECT * FROM pdf_jobs WHERE delivery_channel = 'web'");
    assert.equal(rows.length, 1);
    assert.ok(existsSync(dataDir));
  });
});
