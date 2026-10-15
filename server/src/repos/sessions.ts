import type { Db } from '../db/pool.js';

export type Action = 'compress' | 'protect' | 'word' | 'merge';
export type Step = 'CHOOSE_ACTION' | 'AWAIT_PASSWORD' | 'AWAIT_SECOND_PDF' | 'DONE';
export type SessionStatus = 'RECEIVED' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'EXPIRED' | 'CANCELED';

export interface WaSession {
  id: string;
  phone_number: string;
  file_name: string;
  action_requested: Action | null;
  step: Step;
  status: SessionStatus;
  file_size: string | null;
  storage_dir: string | null;
  extra_file_name: string | null;
  error_code: string | null;
  created_at: Date;
  expires_at: Date;
}

export class SessionsRepo {
  constructor(private readonly db: Db, private readonly ttlMinutes: number) {}

  async create(input: { phone: string; fileName: string; fileSize: number; storageDir: string }): Promise<WaSession> {
    const { rows } = await this.db.query<WaSession>(
      `INSERT INTO whatsapp_sessions (phone_number, file_name, file_size, storage_dir, expires_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
       RETURNING *`,
      [input.phone, input.fileName, input.fileSize, input.storageDir, this.ttlMinutes],
    );
    return rows[0]!;
  }

  // La conversación abierta más reciente de ese número (si no venció).
  async findOpen(phone: string): Promise<WaSession | null> {
    const { rows } = await this.db.query<WaSession>(
      `SELECT * FROM whatsapp_sessions
       WHERE phone_number = $1 AND status = 'RECEIVED' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [phone],
    );
    return rows[0] ?? null;
  }

  async update(id: string, fields: Partial<Pick<WaSession,
    'action_requested' | 'step' | 'status' | 'extra_file_name' | 'error_code'>> & { extendTtl?: boolean }): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [key, value] of Object.entries(fields)) {
      if (key === 'extendTtl') continue;
      values.push(value);
      sets.push(`${key} = $${values.length}`);
    }
    if (fields.extendTtl) {
      values.push(this.ttlMinutes);
      sets.push(`expires_at = now() + make_interval(mins => $${values.length})`);
    }
    if (!sets.length) return;
    await this.db.query(`UPDATE whatsapp_sessions SET ${sets.join(', ')} WHERE id = $1`, values);
  }

  // Cierra las conversaciones abiertas de un número (cuando manda un PDF nuevo o escribe "cancelar").
  async closeOpen(phone: string, status: 'CANCELED' | 'EXPIRED' = 'CANCELED'): Promise<string[]> {
    const { rows } = await this.db.query<{ storage_dir: string | null }>(
      `UPDATE whatsapp_sessions SET status = $2, step = 'DONE'
       WHERE phone_number = $1 AND status = 'RECEIVED'
       RETURNING storage_dir`,
      [phone, status],
    );
    return rows.map((r) => r.storage_dir).filter((d): d is string => !!d);
  }

  // Vence conversaciones abandonadas y libera las que quedaron "procesando" tras un corte.
  async expireStale(stuckMinutes = 60): Promise<string[]> {
    const { rows } = await this.db.query<{ storage_dir: string | null }>(
      `UPDATE whatsapp_sessions SET
         status = CASE WHEN status = 'RECEIVED' THEN 'EXPIRED' ELSE 'FAILED' END,
         error_code = CASE WHEN status = 'RECEIVED' THEN error_code ELSE 'stuck' END,
         step = 'DONE'
       WHERE (status = 'RECEIVED' AND expires_at < now())
          OR (status = 'PROCESSING' AND updated_at < now() - make_interval(mins => $1))
       RETURNING storage_dir`,
      [stuckMinutes],
    );
    return rows.map((r) => r.storage_dir).filter((d): d is string => !!d);
  }
}
