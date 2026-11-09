-- Opt-in + ledger: criação não dispara coleta, nem ativa nenhum projeto.
CREATE TABLE IF NOT EXISTS collection_schedules (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_by INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collection_schedule_slots (
  slot_at TIMESTAMPTZ PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'running',
  run_id INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS collection_schedule_slots_tenant_time
  ON collection_schedule_slots (tenant_id, slot_at DESC);
