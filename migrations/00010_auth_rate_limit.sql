-- 00010: rate limit persistente por HMAC de conta e IP confiável.
-- Aplicação usa DDL idempotente no bootstrap; migration é trilha versionada.
CREATE TABLE IF NOT EXISTS auth_login_limits (
  key_hash TEXT PRIMARY KEY,
  failed_count INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_login_limits_lock ON auth_login_limits (locked_until);
