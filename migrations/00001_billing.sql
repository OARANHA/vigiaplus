-- 00001 — H2/H3: cobranca, dunning e historico de avisos.
-- Idempotente: pode rodar em cima do DDL aditivo de lib/db/index.ts sem erro.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS gateway_customer_id TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS grace_until TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gateway TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reference TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_link TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pix_copia_cola TEXT;
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id INTEGER,
  channel TEXT NOT NULL,
  destination TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  dedupe_key TEXT NOT NULL,
  error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_deliveries_dedupe ON notification_deliveries (tenant_id, dedupe_key);
CREATE INDEX IF NOT EXISTS notification_deliveries_tenant ON notification_deliveries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS invoices_tenant ON invoices (tenant_id, status, due_at);
CREATE INDEX IF NOT EXISTS payment_events_gateway ON payment_events (gateway, received_at DESC);
