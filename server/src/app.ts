// Arma la aplicación Express con todas sus dependencias (lo usan server.ts y las pruebas).
import express, { type ErrorRequestHandler } from 'express';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { PdfEngine } from './engine/pdf.js';
import { createLimit } from './lib/limit.js';
import type { Logger } from './lib/logger.js';
import { EventsRepo } from './repos/events.js';
import { JobsRepo } from './repos/jobs.js';
import { SessionsRepo } from './repos/sessions.js';
import { SubscriptionsRepo } from './repos/subscriptions.js';
import { adminRoutes } from './routes/admin.js';
import { apiRoutes } from './routes/api.js';
import { GraphClient } from './whatsapp/client.js';
import { Conversation } from './whatsapp/conversation.js';
import type { Copy } from './whatsapp/messages.js';
import { MessageQueue } from './whatsapp/queue.js';
import { whatsappWebhook } from './whatsapp/webhook.js';

export const VERSION = '1.0.0';

export function createApp(cfg: Config, db: Db, log: Logger) {
  const events = new EventsRepo(db);
  const jobs = new JobsRepo(db);
  const sessions = new SessionsRepo(db, cfg.SESSION_TTL_MINUTES);
  const subscriptions = new SubscriptionsRepo(db, cfg.FREE_MONTHLY_QUOTA);
  const graph = new GraphClient({
    baseUrl: cfg.META_GRAPH_URL, version: cfg.GRAPH_API_VERSION, accessToken: cfg.META_ACCESS_TOKEN,
    phoneNumberId: cfg.PHONE_NUMBER_ID, log,
  });
  const engine = new PdfEngine({
    gsBin: cfg.GS_BIN, qpdfBin: cfg.QPDF_BIN, timeoutMs: cfg.JOB_TIMEOUT_SECONDS * 1000, brand: cfg.BRAND_NAME, log,
  });
  const copy: Copy = {
    brand: cfg.BRAND_NAME, siteUrl: cfg.SITE_URL.replace(/\/$/, ''), proPrice: cfg.PRO_PRICE_TEXT,
    proQuota: cfg.PRO_MONTHLY_QUOTA, supportWhatsapp: cfg.SUPPORT_WHATSAPP,
  };
  const conversation = new Conversation({
    graph, engine, sessions, subscriptions, jobs, log, copy,
    dataDir: cfg.DATA_DIR, maxBytes: cfg.MAX_FILE_MB * 1024 * 1024,
    limit: createLimit(cfg.WORKER_CONCURRENCY),
  });
  const queue = new MessageQueue(events, conversation, log, cfg.WORKER_CONCURRENCY);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.TRUST_PROXY);

  app.use('/webhook/whatsapp', whatsappWebhook({
    verifyToken: cfg.META_VERIFY_TOKEN, appSecret: cfg.META_APP_SECRET, phoneNumberId: cfg.PHONE_NUMBER_ID,
    events, onEnqueued: () => queue.kick(), log,
  }));
  app.use('/api/admin', adminRoutes({
    token: cfg.ADMIN_API_TOKEN, db, jobs, subscriptions, graph, copy, proQuota: cfg.PRO_MONTHLY_QUOTA, log,
  }));
  app.use('/api', apiRoutes({ db, jobs, engine, version: VERSION }));

  app.use((_req, res) => {
    res.status(404).json({ error: 'no encontrado' });
  });
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) log.error({ err }, 'error no controlado');
    res.status(status).json({ error: status === 500 ? 'error interno' : 'pedido inválido' });
  };
  app.use(onError);

  return { app, queue, sessions, events, engine };
}
