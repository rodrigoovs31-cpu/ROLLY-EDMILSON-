import type { Db } from '../db/pool.js';

export interface WaEvent {
  id: string;
  wamid: string;
  phone_number: string;
  payload: unknown;
  attempts: number;
}

export class EventsRepo {
  constructor(private readonly db: Db) {}

  // Guarda el mensaje; devuelve false si ya lo teníamos (reintento de Meta).
  async enqueue(wamid: string, phone: string, waTimestamp: Date, payload: unknown): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `INSERT INTO whatsapp_events (wamid, phone_number, wa_timestamp, payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (wamid) DO NOTHING`,
      [wamid, phone, waTimestamp, JSON.stringify(payload)],
    );
    return rowCount === 1;
  }

  // Toma el siguiente mensaje pendiente. Nunca dos mensajes del mismo número a la vez,
  // y siempre en el orden en que el cliente los envió (funciona con varias réplicas).
  async claimNext(): Promise<WaEvent | null> {
    const { rows } = await this.db.query<WaEvent>(
      `UPDATE whatsapp_events SET status = 'processing', locked_at = now(), attempts = attempts + 1
       WHERE id = (
         SELECT e.id FROM whatsapp_events e
         WHERE e.status = 'pending'
           AND NOT EXISTS (SELECT 1 FROM whatsapp_events p
                           WHERE p.phone_number = e.phone_number AND p.status = 'processing')
           AND NOT EXISTS (SELECT 1 FROM whatsapp_events o
                           WHERE o.phone_number = e.phone_number AND o.status = 'pending'
                             AND (o.wa_timestamp, o.id) < (e.wa_timestamp, e.id))
         ORDER BY e.wa_timestamp, e.id
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
       RETURNING id, wamid, phone_number, payload, attempts`,
    );
    return rows[0] ?? null;
  }

  // Al terminar se borra el contenido del mensaje (textos, contraseñas): solo queda el tipo.
  async finish(id: string, error?: string): Promise<void> {
    await this.db.query(
      `UPDATE whatsapp_events SET status = $2, last_error = $3, locked_at = NULL,
         payload = jsonb_build_object('type', payload->'type')
       WHERE id = $1`,
      [id, error ? 'failed' : 'done', error ?? null],
    );
  }

  // Tras un reinicio: lo que quedó "processing" vuelve a la cola (máximo 3 intentos).
  async recoverStale(minutes: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE whatsapp_events SET
         status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
         last_error = CASE WHEN attempts >= 3 THEN 'demasiados intentos' ELSE last_error END,
         locked_at = NULL
       WHERE status = 'processing' AND locked_at < now() - make_interval(mins => $1)`,
      [minutes],
    );
    return rowCount ?? 0;
  }

  // Borra la cola vieja (los mensajes no se guardan más de lo necesario).
  async purge(days: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM whatsapp_events WHERE status IN ('done', 'failed') AND received_at < now() - make_interval(days => $1)`,
      [days],
    );
    return rowCount ?? 0;
  }
}
