import type { Db } from '../db/pool.js';

export type Plan = 'FREE' | 'PRO_WHATSAPP';

export interface Subscription {
  id: string;
  user_id: string | null;
  phone_number: string | null;
  plan: Plan;
  monthly_quota: number;
  used_quota: number;
  status: 'active' | 'canceled';
  period_start: string;
  paid_until: Date | null;
}

const MONTH = `date_trunc('month', now())::date`;

export class SubscriptionsRepo {
  constructor(private readonly db: Db, private readonly freeQuota: number) {}

  // Devuelve la suscripción del número (la crea en FREE la primera vez),
  // con el cupo del mes ya reiniciado y el Pro vencido devuelto a FREE.
  async forPhone(phone: string): Promise<Subscription> {
    await this.db.query(
      `INSERT INTO subscriptions (phone_number, plan, monthly_quota)
       VALUES ($1, 'FREE', $2)
       ON CONFLICT (phone_number) WHERE phone_number IS NOT NULL DO NOTHING`,
      [phone, this.freeQuota],
    );
    const { rows } = await this.db.query<Subscription>(
      `UPDATE subscriptions SET
         plan          = CASE WHEN plan = 'PRO_WHATSAPP' AND paid_until < now() THEN 'FREE' ELSE plan END,
         monthly_quota = CASE WHEN plan = 'PRO_WHATSAPP' AND paid_until < now() THEN $2 ELSE monthly_quota END,
         used_quota    = CASE WHEN period_start < ${MONTH} THEN 0 ELSE used_quota END,
         period_start  = ${MONTH}
       WHERE phone_number = $1
       RETURNING *`,
      [phone, this.freeQuota],
    );
    return rows[0]!;
  }

  hasQuota(sub: Subscription): boolean {
    return sub.status === 'active' && sub.used_quota < sub.monthly_quota;
  }

  // Descuenta 1 del cupo solo si todavía queda (atómico).
  async consume(phone: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE subscriptions SET used_quota = used_quota + 1
       WHERE phone_number = $1 AND status = 'active' AND used_quota < monthly_quota`,
      [phone],
    );
    return rowCount === 1;
  }

  // Activa o extiende PRO_WHATSAPP después de confirmar el pago (Yape, transferencia…).
  async grantPro(phone: string, months: number, quota: number, userId: string | null = null): Promise<Subscription> {
    const { rows } = await this.db.query<Subscription>(
      `INSERT INTO subscriptions (phone_number, user_id, plan, monthly_quota, status, paid_until)
       VALUES ($1, $2, 'PRO_WHATSAPP', $3, 'active', now() + make_interval(months => $4))
       ON CONFLICT (phone_number) WHERE phone_number IS NOT NULL DO UPDATE SET
         plan = 'PRO_WHATSAPP',
         monthly_quota = EXCLUDED.monthly_quota,
         status = 'active',
         user_id = COALESCE(EXCLUDED.user_id, subscriptions.user_id),
         paid_until = GREATEST(COALESCE(subscriptions.paid_until, now()), now()) + make_interval(months => $4)
       RETURNING *`,
      [phone, userId, quota, months],
    );
    return rows[0]!;
  }

  async setStatus(phone: string, status: 'active' | 'canceled'): Promise<Subscription | null> {
    const { rows } = await this.db.query<Subscription>(
      'UPDATE subscriptions SET status = $2 WHERE phone_number = $1 RETURNING *',
      [phone, status],
    );
    return rows[0] ?? null;
  }

  async get(phone: string): Promise<Subscription | null> {
    const { rows } = await this.db.query<Subscription>('SELECT * FROM subscriptions WHERE phone_number = $1', [phone]);
    return rows[0] ?? null;
  }
}
