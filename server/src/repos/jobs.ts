import type { Db } from '../db/pool.js';

export interface JobInput {
  userId?: string | null;
  action: string;
  fileSizeIn?: number | null;
  fileSizeOut?: number | null;
  processingTimeMs?: number | null;
  channel: 'web' | 'whatsapp';
  status?: 'done' | 'failed';
  errorCode?: string | null;
}

export class JobsRepo {
  constructor(private readonly db: Db) {}

  async record(job: JobInput): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO pdf_jobs (user_id, action, file_size_in, file_size_out, processing_time_ms, delivery_channel, status, error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [job.userId ?? null, job.action, job.fileSizeIn ?? null, job.fileSizeOut ?? null,
        job.processingTimeMs == null ? null : Math.round(job.processingTimeMs), job.channel, job.status ?? 'done', job.errorCode ?? null],
    );
    return rows[0]!.id;
  }

  async stats(days: number) {
    const { rows } = await this.db.query(
      `SELECT delivery_channel AS channel, action, status,
              count(*)::int AS jobs,
              COALESCE(sum(file_size_in), 0)::bigint AS bytes_in,
              COALESCE(sum(file_size_out), 0)::bigint AS bytes_out,
              COALESCE(round(avg(processing_time_ms)), 0)::int AS avg_ms
       FROM pdf_jobs
       WHERE created_at > now() - make_interval(days => $1)
       GROUP BY 1, 2, 3
       ORDER BY jobs DESC`,
      [days],
    );
    return rows;
  }
}
