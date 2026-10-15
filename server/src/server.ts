// Punto de entrada de rolly_api: API REST + webhook de WhatsApp Cloud API (Graph API v21.0).
import { mkdir, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createApp, VERSION } from './app.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { createLogger } from './lib/logger.js';

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const log = createLogger(cfg.LOG_LEVEL, cfg.NODE_ENV === 'development' && process.stdout.isTTY);
const db = createPool(cfg.DATABASE_URL, cfg.DB_POOL_MAX, log);

async function main() {
  await mkdir(cfg.DATA_DIR, { recursive: true, mode: 0o700 });
  if (cfg.RUN_MIGRATIONS) {
    await migrate(db);
    log.info('esquema de base de datos al día');
  }

  const { app, queue, sessions, events, engine } = createApp(cfg, db, log);
  const tools = await engine.selfCheck();
  if (!tools.qpdf || !tools.gs) log.warn(tools, 'faltan qpdf o Ghostscript: el canal WhatsApp no podrá procesar PDF');

  // Mantenimiento: borra archivos de conversaciones vencidas y recupera mensajes atascados.
  const housekeeping = async () => {
    try {
      const dirs = await sessions.expireStale();
      await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
      const recovered = await events.recoverStale(Math.ceil(cfg.JOB_TIMEOUT_SECONDS / 60) * 3);
      if (recovered) queue.kick();
      if (dirs.length || recovered) log.info({ expired: dirs.length, recovered }, 'mantenimiento');
    } catch (err) {
      log.error({ err }, 'falló el mantenimiento');
    }
  };
  const purge = () => events.purge(7).catch((err) => log.error({ err }, 'falló la limpieza de la cola'));
  const t1 = setInterval(housekeeping, 60_000);
  const t2 = setInterval(purge, 6 * 3600_000);
  t1.unref();
  t2.unref();
  await housekeeping();
  queue.start();

  const server: Server = app.listen(cfg.PORT, () => log.info({ port: cfg.PORT, version: VERSION }, 'rolly_api escuchando'));
  server.keepAliveTimeout = 65_000;  // mayor que el keepalive de nginx
  server.headersTimeout = 66_000;

  // Apagado ordenado (docker stop): deja de aceptar pedidos y termina lo que está en curso.
  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'apagando…');
    clearInterval(t1);
    clearInterval(t2);
    server.close();
    const force = setTimeout(() => process.exit(1), 25_000);
    force.unref();
    await queue.stop();
    await db.end();
    log.info('apagado completo');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => log.error({ err }, 'promesa rechazada sin capturar'));

main().catch((err) => {
  log.fatal({ err }, 'no se pudo iniciar el servidor');
  process.exit(1);
});
