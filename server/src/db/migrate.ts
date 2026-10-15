// Aplica schema.sql. Es idempotente y usa un candado para que dos réplicas
// que arrancan a la vez no choquen.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { Db } from './pool.js';

const SCHEMA = fileURLToPath(new URL('./schema.sql', import.meta.url));
const LOCK_ID = 7_241_993_575;

export async function migrate(db: Db): Promise<void> {
  const sql = await readFile(SCHEMA, 'utf8');
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

// Uso directo: node dist/db/migrate.js
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Falta DATABASE_URL');
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  migrate(pool)
    .then(() => console.log('Esquema aplicado correctamente.'))
    .catch((err) => {
      console.error('No se pudo aplicar el esquema:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
