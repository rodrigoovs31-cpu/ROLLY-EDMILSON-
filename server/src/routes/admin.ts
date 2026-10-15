// API de administración (protegida con ADMIN_API_TOKEN). Ejemplo:
//   curl -H "Authorization: Bearer $ADMIN_API_TOKEN" https://tu-dominio/api/admin/stats
import express, { Router, type RequestHandler } from 'express';
import { timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import type { Logger } from '../lib/logger.js';
import { rateLimit } from '../lib/rate-limit.js';
import type { JobsRepo } from '../repos/jobs.js';
import type { SubscriptionsRepo } from '../repos/subscriptions.js';
import type { GraphClient } from '../whatsapp/client.js';
import { t, type Copy } from '../whatsapp/messages.js';

const phone = z.string().transform((s) => s.replace(/\D/g, '')).pipe(z.string().regex(/^\d{6,15}$/, 'número inválido: usa el formato internacional, ej. 51987654321'));

function bearer(token: string): RequestHandler {
  const want = createHash('sha256').update(token).digest();
  return (req, res, next) => {
    const got = createHash('sha256').update((req.get('authorization') ?? '').replace(/^Bearer\s+/i, '')).digest();
    if (!timingSafeEqual(want, got)) {
      res.status(401).json({ error: 'no autorizado' });
      return;
    }
    next();
  };
}

export function adminRoutes(d: {
  token: string; db: Db; jobs: JobsRepo; subscriptions: SubscriptionsRepo; graph: GraphClient;
  copy: Copy; proQuota: number; log: Logger;
}): Router {
  const router = Router();
  router.use(rateLimit(60, 60_000), bearer(d.token), express.json({ limit: '16kb' }));

  router.get('/stats', async (req, res) => {
    const days = z.coerce.number().int().min(1).max(365).catch(30).parse(req.query.days);
    const [jobs, sessions, subs] = await Promise.all([
      d.jobs.stats(days),
      d.db.query(`SELECT status, count(*)::int AS n FROM whatsapp_sessions
                  WHERE created_at > now() - make_interval(days => $1) GROUP BY 1`, [days]),
      d.db.query(`SELECT plan, status, count(*)::int AS n, COALESCE(sum(used_quota), 0)::int AS used
                  FROM subscriptions GROUP BY 1, 2`),
    ]);
    res.json({ days, jobs, whatsapp_sessions: sessions.rows, subscriptions: subs.rows });
  });

  router.get('/subscriptions/:phone', async (req, res) => {
    const p = phone.safeParse(req.params.phone);
    if (!p.success) return void res.status(400).json({ error: p.error.issues[0]?.message });
    const sub = await d.subscriptions.get(p.data);
    if (!sub) return void res.status(404).json({ error: 'sin suscripción' });
    res.json(sub);
  });

  // Activa Pro WhatsApp después de confirmar el pago (Yape, Plin, transferencia).
  router.post('/subscriptions/pro', async (req, res) => {
    const body = z.object({
      phone_number: phone,
      months: z.number().int().min(1).max(24).default(1),
      notify: z.boolean().default(true),
    }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.issues[0]?.message });
    const sub = await d.subscriptions.grantPro(body.data.phone_number, body.data.months, d.proQuota);
    d.log.info({ phone: body.data.phone_number.slice(-4), months: body.data.months }, 'Pro WhatsApp activado');
    let notified = false;
    if (body.data.notify && sub.paid_until) {
      // Solo llega si el cliente escribió en las últimas 24 h (regla de WhatsApp).
      notified = await d.graph.sendText(body.data.phone_number, t.proActivated(d.copy, new Date(sub.paid_until)))
        .then(() => true, () => false);
    }
    res.json({ subscription: sub, notified });
  });

  // Suspende (status 'canceled') o reactiva un número, por ejemplo ante abuso o un pago revertido.
  router.post('/subscriptions/status', async (req, res) => {
    const body = z.object({ phone_number: phone, status: z.enum(['active', 'canceled']) }).safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: body.error.issues[0]?.message });
    const sub = await d.subscriptions.setStatus(body.data.phone_number, body.data.status);
    if (!sub) return void res.status(404).json({ error: 'sin suscripción' });
    res.json({ subscription: sub });
  });

  return router;
}
