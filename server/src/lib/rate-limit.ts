import type { RequestHandler } from 'express';

// Límite de pedidos por IP en memoria (suficiente para una réplica; con varias, usar nginx limit_req).
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { count: number; reset: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref();
  return (req, res, next) => {
    const key = req.ip ?? 'anon';
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset <= now) {
      h = { count: 0, reset: now + windowMs };
      hits.set(key, h);
    }
    if (++h.count > max) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000));
      res.status(429).json({ error: 'demasiados pedidos, espera un momento' });
      return;
    }
    next();
  };
}
