// Crea un usuario administrador:  node dist/scripts/create-admin.js correo@ejemplo.com
// La contraseña se pide por la terminal (no queda en el historial de bash).
import { createInterface } from 'node:readline/promises';
import pg from 'pg';
import { hashPassword } from '../lib/password.js';
import { UsersRepo } from '../repos/users.js';

const email = process.argv[2];
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Uso: node dist/scripts/create-admin.js correo@ejemplo.com');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = process.env.ADMIN_PASSWORD ?? (await rl.question('Contraseña (mínimo 12 caracteres): '));
rl.close();
if (password.length < 12) {
  console.error('La contraseña debe tener al menos 12 caracteres.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const user = await new UsersRepo(pool).create(email, await hashPassword(password), 'admin');
  console.log(`Administrador creado: ${user.email} (${user.id})`);
} catch (err) {
  console.error('No se pudo crear:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
