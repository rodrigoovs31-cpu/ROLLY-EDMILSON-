// API pública. La web NO envía archivos: solo estadísticas anónimas de uso (acción, pesos, tiempo).
import express, { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import type { PdfEngine } from '../engine/pdf.js';
import { rateLimit } from '../lib/rate-limit.js';
import type { JobsRepo } from '../repos/jobs.js';

const MAX = 2 * 1024 * 1024 * 1024;
const webJob = z.object({
  action: z.string().regex(/^[a-z0-9-]{2,40}$/),
  file_size_in: z.number().int().min(0).max(MAX).optional(),
  file_size_out: z.number().int().min(0).max(MAX).optional(),
  processing_time_ms: z.number().min(0).max(3_600_000).optional(),
  status: z.enum(['done', 'failed']).optional(),
});

export function apiRoutes(d: { db: Db; jobs: JobsRepo; engine: PdfEngine; version: string }): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    let db = false;
    try {
      await d.db.query('SELECT 1');
      db = true;
    } catch { /* se informa abajo */ }
    res.status(db ? 200 : 503).json({ ok: db, db, version: d.version, uptime_s: Math.round(process.uptime()) });
  });

  // Diagnóstico de herramientas del servidor (qpdf, Ghostscript).
  router.get('/health/engine', async (_req, res) => {
    const tools = await d.engine.selfCheck();
    res.status(tools.qpdf && tools.gs ? 200 : 503).json(tools);
  });

  router.post('/jobs', rateLimit(120, 60_000), express.json({ limit: '4kb' }), async (req, res) => {
    const parsed = webJob.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'datos inválidos' });
      return;
    }
    const j = parsed.data;
    await d.jobs.record({
      action: j.action, channel: 'web', fileSizeIn: j.file_size_in, fileSizeOut: j.file_size_out,
      processingTimeMs: j.processing_time_ms, status: j.status,
    });
    res.sendStatus(204);
  });

  return router;
}
