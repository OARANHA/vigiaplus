-- 00002 — H1: Row Level Security (defesa em profundidade).
--
-- O app ja filtra tenant_id em codigo (lib/tenant/context.ts). Aqui o BANCO
-- tambem filtra: se uma query esquecer o WHERE, ainda assim nao vaza.
--
-- Semantica da policy: quando `app.tenant_id` NAO esta definido, o papel de
-- servico (bootstrap, migrations, console do dono em visao de carteira) ve
-- tudo. Quando esta definido, so enxerga aquele tenant. E(opt-in) por
-- transacao via lib/tenant/scope.ts, o que evita quebrar o legado.
--
-- EM PRODUCAO: crie um papel `vigiaplus_app` que NAO seja dono das tabelas e
-- NAO tenha BYPASSRLS, e rode a aplicacao com ele. Se a app rodar como o dono
-- do schema, o Postgres ignora RLS e esta camada nao protege nada.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON tenants;
CREATE POLICY vigia_tenant_isolation ON tenants
  USING (current_setting('app.tenant_id', true) IS NULL
      OR current_setting('app.tenant_id', true) = ''
      OR id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL
      OR current_setting('app.tenant_id', true) = ''
      OR id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON memberships;
CREATE POLICY vigia_tenant_isolation ON memberships
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON tenant_features;
CREATE POLICY vigia_tenant_isolation ON tenant_features
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE reputation_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON reputation_targets;
CREATE POLICY vigia_tenant_isolation ON reputation_targets
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON incidents;
CREATE POLICY vigia_tenant_isolation ON incidents
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE incident_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON incident_actions;
CREATE POLICY vigia_tenant_isolation ON incident_actions
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR incident_id IN (SELECT id FROM incidents))
  WITH CHECK (true);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON projects;
CREATE POLICY vigia_tenant_isolation ON projects
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON subscriptions;
CREATE POLICY vigia_tenant_isolation ON subscriptions
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON invoices;
CREATE POLICY vigia_tenant_isolation ON invoices
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON payment_events;
CREATE POLICY vigia_tenant_isolation ON payment_events
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE notification_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON notification_channels;
CREATE POLICY vigia_tenant_isolation ON notification_channels
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON alert_rules;
CREATE POLICY vigia_tenant_isolation ON alert_rules
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON notification_deliveries;
CREATE POLICY vigia_tenant_isolation ON notification_deliveries
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON llm_usage;
CREATE POLICY vigia_tenant_isolation ON llm_usage
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE mcp_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON mcp_tokens;
CREATE POLICY vigia_tenant_isolation ON mcp_tokens
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON invitations;
CREATE POLICY vigia_tenant_isolation ON invitations
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vigia_tenant_isolation ON audit_events;
CREATE POLICY vigia_tenant_isolation ON audit_events
  USING (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer)
  WITH CHECK (current_setting('app.tenant_id', true) IS NULL OR current_setting('app.tenant_id', true) = '' OR tenant_id = current_setting('app.tenant_id', true)::integer);
