import type { Db } from '../db/pool.js';

export type Role = 'user' | 'pro' | 'admin';

export interface User {
  id: string;
  email: string;
  rol: Role;
  created_at: Date;
}

export class UsersRepo {
  constructor(private readonly db: Db) {}

  async create(email: string, passwordHash: string, rol: Role = 'user'): Promise<User> {
    const { rows } = await this.db.query<User>(
      `INSERT INTO users (email, password_hash, rol) VALUES ($1, $2, $3)
       RETURNING id, email, rol, created_at`,
      [email.trim(), passwordHash, rol],
    );
    return rows[0]!;
  }

  async findByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
    const { rows } = await this.db.query<User & { password_hash: string }>(
      'SELECT id, email, rol, created_at, password_hash FROM users WHERE lower(email) = lower($1)',
      [email.trim()],
    );
    return rows[0] ?? null;
  }

  async setRole(id: string, rol: Role): Promise<void> {
    await this.db.query('UPDATE users SET rol = $2 WHERE id = $1', [id, rol]);
  }
}
