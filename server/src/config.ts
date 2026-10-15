// Configuración validada al arrancar: si falta una variable, el servidor no inicia
// y dice exactamente cuál (mejor fallar al desplegar que en medio de un cliente).
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Detrás de nginx: confiar en X-Forwarded-For de un solo salto.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria (postgres://usuario:clave@host:5432/base)'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  RUN_MIGRATIONS: bool.default(true),

  // WhatsApp Cloud API (Meta)
  META_VERIFY_TOKEN: z.string().min(8, 'META_VERIFY_TOKEN: inventa una frase larga (mínimo 8 caracteres)'),
  META_ACCESS_TOKEN: z.string().min(10, 'META_ACCESS_TOKEN: token de acceso del usuario del sistema'),
  META_APP_SECRET: z.string().min(10, 'META_APP_SECRET: "Clave secreta de la app" (Configuración básica de tu app en Meta)'),
  PHONE_NUMBER_ID: z.string().regex(/^\d+$/, 'PHONE_NUMBER_ID: el identificador numérico de tu número en WhatsApp Manager'),
  GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v21.0'),
  META_GRAPH_URL: z.url().default('https://graph.facebook.com'),

  // Negocio
  SITE_URL: z.url().default('https://example.com'),
  BRAND_NAME: z.string().min(1).default('DocuMaus'),
  FREE_MONTHLY_QUOTA: z.coerce.number().int().min(0).default(10),
  PRO_MONTHLY_QUOTA: z.coerce.number().int().min(1).default(500),
  PRO_PRICE_TEXT: z.string().default('S/ 9 al mes'),
  // WhatsApp personal del dueño para ventas y soporte (formato internacional sin +, ej. 51987654321).
  SUPPORT_WHATSAPP: z.string().regex(/^\d{8,15}$/, 'SUPPORT_WHATSAPP: solo dígitos con código de país, ej. 51987654321').optional().or(z.literal('').transform(() => undefined)),
  ADMIN_API_TOKEN: z.string().min(24, 'ADMIN_API_TOKEN: genera uno con: openssl rand -hex 32'),

  // Procesamiento
  MAX_FILE_MB: z.coerce.number().min(1).max(100).default(100),
  SESSION_TTL_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(30),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  JOB_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(900).default(180),
  DATA_DIR: z.string().default('/tmp/rolly'),
  GS_BIN: z.string().default('gs'),
  QPDF_BIN: z.string().default('qpdf'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => {
      const missing = i.code === 'invalid_type' && env[String(i.path[0])] === undefined;
      return `  - ${i.path.join('.')}: ${missing ? 'falta (agrégala a tu archivo .env)' : i.message}`;
    });
    throw new Error(`Configuración inválida. Revisa tu archivo .env:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
