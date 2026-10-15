// Imitación local de la Graph API de Meta para probar el flujo completo sin internet.
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import express from 'express';

export interface Upload { id: string; mime: string; fileName: string; bytes: Buffer }

export async function startMockGraph(token: string, phoneNumberId: string, port = 0) {
  const media = new Map<string, { bytes: Buffer; mime: string }>();
  const uploads = new Map<string, Upload>();
  const sent: Array<Record<string, any>> = [];
  let base = '';

  const app = express();
  app.use((req, res, next) => {
    if (req.get('authorization') !== `Bearer ${token}`) {
      res.status(401).json({ error: { message: 'Invalid OAuth access token', code: 190 } });
      return;
    }
    next();
  });
  app.get('/v21.0/:id', (req, res) => {
    const m = media.get(req.params.id);
    if (!m) return void res.status(404).json({ error: { message: 'media not found', code: 100 } });
    res.json({
      messaging_product: 'whatsapp', id: req.params.id, url: `${base}/download/${req.params.id}`,
      mime_type: m.mime, sha256: createHash('sha256').update(m.bytes).digest('hex'), file_size: m.bytes.length,
    });
  });
  app.get('/download/:id', (req, res) => {
    const m = media.get(req.params.id);
    if (!m) return void res.sendStatus(404);
    res.type(m.mime).send(m.bytes);
  });
  app.post(`/v21.0/${phoneNumberId}/media`, express.raw({ type: '*/*', limit: '200mb' }), async (req, res) => {
    const form = await new Response(req.body, { headers: { 'content-type': req.get('content-type') ?? '' } }).formData();
    const file = form.get('file') as File;
    if (form.get('messaging_product') !== 'whatsapp' || !file) return void res.status(400).json({ error: { message: 'bad upload' } });
    const id = `up-${randomUUID()}`;
    uploads.set(id, { id, mime: String(form.get('type')), fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
    res.json({ id });
  });
  app.post(`/v21.0/${phoneNumberId}/messages`, express.json(), (req, res) => {
    sent.push(req.body);
    res.json({ messaging_product: 'whatsapp', messages: [{ id: `wamid.out.${sent.length}` }] });
  });

  const server = app.listen(port, '0.0.0.0');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (process.env.MOCK_PUBLIC_BASE) base = process.env.MOCK_PUBLIC_BASE;

  return {
    base,
    sent,
    uploads,
    addMedia(bytes: Uint8Array | Buffer, mime = 'application/pdf') {
      const id = `in-${randomUUID()}`;
      media.set(id, { bytes: Buffer.from(bytes), mime });
      return id;
    },
    // Mensajes enviados al cliente (sin los "marcar como leído").
    messages: () => sent.filter((m) => m.type),
    clear: () => { sent.length = 0; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
