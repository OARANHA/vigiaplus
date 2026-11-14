-- VIGIAPLUS / ALT-08.10C.38 — provisionamento HML isolado.
-- REGISTRO VERSIONADO da etapa aplicada em 2026-11-14.
-- Reaplicar SOMENTE em nova database vazia, na branch HML especificamente
-- autorizada. Não é migration de produção e não é automaticamente executada.
-- Exige 186 instruções do snapshot Git blob
-- 068db8eaf3f6dc4ad7fbcf5014ffe687d077ae15
-- previamente aplicadas sob transação; este arquivo NÃO as duplica.
-- NUNCA aplicar migrations/00002_rls.sql: NULL/empty tenant é fail-open.
-- Em produção: NO-GO. Sem conexão a banco operacional de clientes.

BEGIN;
SET LOCAL statement_timeout = '60000ms';
DO $hml$
BEGIN
  IF current_database() <> 'vigiaplus_hml_20261114' THEN
    RAISE EXCEPTION 'ALT0810C38_HML_DB_ONLY';
  END IF;
  IF (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public') <> 62 THEN
    RAISE EXCEPTION 'ALT0810C38_BOOTSTRAP_TABLE_COUNT_DENIED';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vigia_hml_reader_20261114') THEN
    RAISE EXCEPTION 'ALT0810C38_ROLE_ALREADY_PRESENT';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname='hml_tenant_select') THEN
    RAISE EXCEPTION 'ALT0810C38_POLICY_ALREADY_PRESENT';
  END IF;
END;
$hml$;

CREATE ROLE vigia_hml_reader_20261114
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
GRANT vigia_hml_reader_20261114 TO vigia_alt083_ci_20261112_owner
  WITH SET TRUE, INHERIT FALSE;
GRANT USAGE ON SCHEMA public TO vigia_hml_reader_20261114;

-- Reader: 4 superfícies expressamente permitidas. Sem acesso a users,
-- memberships, plans, tokens, workers, notification destination, PIX etc.
GRANT SELECT (id,name,kind,score) ON public.reputation_targets
  TO vigia_hml_reader_20261114;
ALTER TABLE public.reputation_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY hml_tenant_select ON public.reputation_targets
  AS PERMISSIVE FOR SELECT TO vigia_hml_reader_20261114
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer);

GRANT SELECT (id,title,status,severity) ON public.incidents
  TO vigia_hml_reader_20261114;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incidents FORCE ROW LEVEL SECURITY;
CREATE POLICY hml_tenant_select ON public.incidents
  AS PERMISSIVE FOR SELECT TO vigia_hml_reader_20261114
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer);

GRANT SELECT (id,channel,active,verified) ON public.notification_channels
  TO vigia_hml_reader_20261114;
ALTER TABLE public.notification_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_channels FORCE ROW LEVEL SECURITY;
CREATE POLICY hml_tenant_select ON public.notification_channels
  AS PERMISSIVE FOR SELECT TO vigia_hml_reader_20261114
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer);

GRANT SELECT (id,amount_brl,status,due_at) ON public.invoices
  TO vigia_hml_reader_20261114;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY hml_tenant_select ON public.invoices
  AS PERMISSIVE FOR SELECT TO vigia_hml_reader_20261114
  USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer);

REVOKE USAGE ON SCHEMA public FROM PUBLIC;

-- Auditoria em database HML: não configura/libera aplicação operacional.
CREATE TABLE public.vigiaplus_hml_schema_receipts (
  gate text PRIMARY KEY,
  code_head_sha text NOT NULL,
  snapshot_git_blob_sha text NOT NULL,
  sql_statement_count integer NOT NULL,
  table_count integer NOT NULL,
  rls_policy_count integer NOT NULL,
  scope text NOT NULL CHECK (scope='ISOLATED_HML_ONLY'),
  production_ready boolean NOT NULL DEFAULT false CHECK (production_ready=false),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.vigiaplus_hml_schema_receipts
  (gate,code_head_sha,snapshot_git_blob_sha,sql_statement_count,table_count,rls_policy_count,scope)
VALUES
  ('ALT-08.10C.38','4ef54af26baae531f0ae0363eed2b890d8bf759c',
   '068db8eaf3f6dc4ad7fbcf5014ffe687d077ae15',186,62,4,'ISOLATED_HML_ONLY');

COMMIT;
