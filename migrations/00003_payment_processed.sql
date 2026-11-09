-- 00003 — eventos de cobrança: rastrear processamento para retentativa segura.
-- A migration não reescreve os dados históricos nem altera 00001/00002.
ALTER TABLE payment_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS payment_events_pending
  ON payment_events (received_at) WHERE processed_at IS NULL;
