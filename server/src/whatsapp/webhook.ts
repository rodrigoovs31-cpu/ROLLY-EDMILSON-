// Webhook de WhatsApp Cloud API.
//   GET  /webhook/whatsapp → verificación inicial (hub.challenge)
//   POST /webhook/whatsapp → mensajes entrantes, firmados con X-Hub-Signature-256
import express, { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Logger } from '../lib/logger.js';
import type { EventsRepo } from '../repos/events.js';
import { verifySignature } from './signature.js';
import { webhookBody } from './types.js';

export interface WebhookDeps {
  verifyToken: string;
  appSecret: string;
  phoneNumberId: string;
  events: EventsRepo;
  onEnqueued: () => void;
  log: Logger;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function whatsappWebhook(d: WebhookDeps): Router {
  const router = Router();

  // Meta llama a esta URL una vez al configurar el webhook y espera el challenge tal cual.
  router.get('/', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && typeof token === 'string' && safeEqual(token, d.verifyToken) && typeof challenge === 'string') {
      d.log.info('webhook de WhatsApp verificado por Meta');
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    d.log.warn({ mode }, 'verificación de webhook rechazada');
    res.sendStatus(403);
  });

  // El cuerpo se lee CRUDO: la firma se calcula sobre los bytes exactos que envió Meta.
  router.post('/', express.raw({ type: '*/*', limit: '2mb' }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifySignature(raw, req.get('x-hub-signature-256'), d.appSecret)) {
      d.log.warn({ ip: req.ip }, 'webhook con firma inválida');
      res.sendStatus(401);
      return;
    }

    let body;
    try {
      body = webhookBody.parse(JSON.parse(raw.toString('utf8')));
    } catch {
      res.sendStatus(400);
      return;
    }
    if (body.object !== 'whatsapp_business_account') {
      res.sendStatus(404);
      return;
    }

    try {
      let queued = 0;
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          if (change.field !== 'messages') continue;
          const v = change.value;
          if (v.metadata && v.metadata.phone_number_id !== d.phoneNumberId) continue;  // otro número de la misma app
          for (const s of v.statuses ?? []) {
            if (s.status === 'failed') d.log.warn({ id: s.id, errors: s.errors }, 'WhatsApp no pudo entregar un mensaje');
          }
          for (const m of v.messages ?? []) {
            const msg = m as { id?: unknown; from?: unknown; timestamp?: unknown };
            if (typeof msg.id !== 'string' || typeof msg.from !== 'string') continue;
            const ts = new Date(Number(msg.timestamp ?? Date.now() / 1000) * 1000);
            if (await d.events.enqueue(msg.id, msg.from, Number.isNaN(ts.getTime()) ? new Date() : ts, m)) queued++;
          }
        }
      }
      // Responder rápido: Meta reintenta si no recibe 200 en pocos segundos.
      res.status(200).send('EVENT_RECEIVED');
      if (queued) d.onEnqueued();
    } catch (err) {
      // Sin base de datos no podemos garantizar el mensaje: 500 para que Meta lo reintente.
      d.log.error({ err }, 'no se pudo guardar el mensaje entrante');
      res.sendStatus(500);
    }
  });

  return router;
}
