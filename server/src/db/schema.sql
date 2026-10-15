-- Esquema de Maus / DocuMaus para PostgreSQL 16.
-- Es idempotente: se puede ejecutar en cada arranque sin perder datos.

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- Toca updated_at en cada UPDATE.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Usuarios de la web (cuentas Pro y administradores).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,                    -- scrypt$N$r$p$salt$hash, nunca la clave en texto plano
  rol           text NOT NULL DEFAULT 'user' CHECK (rol IN ('user', 'pro', 'admin')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Cada documento procesado (web o WhatsApp). Solo metadatos: nunca el archivo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pdf_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid REFERENCES users (id) ON DELETE SET NULL,
  action             text NOT NULL CHECK (action ~ '^[a-z0-9-]{2,40}$'),
  file_size_in       bigint CHECK (file_size_in >= 0),
  file_size_out      bigint CHECK (file_size_out >= 0),
  processing_time_ms integer CHECK (processing_time_ms >= 0),
  delivery_channel   text NOT NULL CHECK (delivery_channel IN ('web', 'whatsapp')),
  status             text NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'failed')),
  error_code         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pdf_jobs_created_idx ON pdf_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS pdf_jobs_user_idx ON pdf_jobs (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Conversaciones de WhatsApp: un documento recibido y lo que el cliente pidió hacer.
-- status: RECEIVED → PROCESSING → DELIVERED (y FAILED / EXPIRED / CANCELED para cerrar
-- las sesiones que no terminan bien, así ninguna queda "procesando" para siempre).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number     text NOT NULL CHECK (phone_number ~ '^[0-9]{6,15}$'),
  file_name        text NOT NULL,
  action_requested text CHECK (action_requested IN ('compress', 'protect', 'word', 'merge')),
  step             text NOT NULL DEFAULT 'CHOOSE_ACTION'
                     CHECK (step IN ('CHOOSE_ACTION', 'AWAIT_PASSWORD', 'AWAIT_SECOND_PDF', 'DONE')),
  status           text NOT NULL DEFAULT 'RECEIVED'
                     CHECK (status IN ('RECEIVED', 'PROCESSING', 'DELIVERED', 'FAILED', 'EXPIRED', 'CANCELED')),
  file_size        bigint,
  storage_dir      text,                          -- carpeta temporal en el servidor (se borra al terminar)
  extra_file_name  text,                          -- segundo PDF al unir
  error_code       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
CREATE INDEX IF NOT EXISTS whatsapp_sessions_phone_idx ON whatsapp_sessions (phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_sessions_open_idx ON whatsapp_sessions (expires_at)
  WHERE status IN ('RECEIVED', 'PROCESSING');
DROP TRIGGER IF EXISTS whatsapp_sessions_touch ON whatsapp_sessions;
CREATE TRIGGER whatsapp_sessions_touch BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Planes y cupos (por número de WhatsApp y/o usuario web).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  phone_number  text CHECK (phone_number ~ '^[0-9]{6,15}$'),
  plan          text NOT NULL DEFAULT 'FREE' CHECK (plan IN ('FREE', 'PRO_WHATSAPP')),
  monthly_quota integer NOT NULL CHECK (monthly_quota >= 0),
  used_quota    integer NOT NULL DEFAULT 0 CHECK (used_quota >= 0),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled')),
  period_start  date NOT NULL DEFAULT date_trunc('month', now())::date,  -- el cupo se reinicia cada mes
  paid_until    timestamptz,                                            -- fin del periodo Pro pagado
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR phone_number IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_phone_key ON subscriptions (phone_number) WHERE phone_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (user_id);
DROP TRIGGER IF EXISTS subscriptions_touch ON subscriptions;
CREATE TRIGGER subscriptions_touch BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS users_touch ON users;
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- Cola de mensajes entrantes de WhatsApp.
-- Meta reintenta los webhooks: el wamid único evita procesar dos veces el mismo mensaje,
-- y la cola permite responder 200 al instante y procesar en segundo plano (y retomar
-- el trabajo si el servidor se reinicia).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_events (
  id           bigserial PRIMARY KEY,
  wamid        text NOT NULL UNIQUE,
  phone_number text NOT NULL,
  wa_timestamp timestamptz NOT NULL,
  payload      jsonb NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts     integer NOT NULL DEFAULT 0,
  locked_at    timestamptz,
  last_error   text,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_events_pending_idx ON whatsapp_events (wa_timestamp, id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS whatsapp_events_phone_idx ON whatsapp_events (phone_number, status);
