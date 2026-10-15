import pg from 'pg';
import type { Logger } from '../lib/logger.js';

export type Db = pg.Pool;

export function createPool(url: string, max: number, log: Logger): Db {
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'rolly_api',
  });
  // Un error en una conexión inactiva (p. ej. reinicio de Postgres) no debe tumbar el proceso.
  pool.on('error', (err) => log.error({ err }, 'error en una conexión inactiva de PostgreSQL'));
  return pool;
}
