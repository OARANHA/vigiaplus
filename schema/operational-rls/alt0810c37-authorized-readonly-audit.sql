-- ALT-08.10C.37 - PACOTE DE AUDITORIA OPERACIONAL SOMENTE LEITURA
--
-- NÃO EXECUTAR até autorização explícita do proprietário identificando:
-- ambiente/projeto/branch/database, role de auditoria e destino seguro da saída.
-- Em particular, este arquivo NÃO autoriza acesso ao Neon nem pg_dump de dados.
-- Conferir, antes da execução, se as tabelas realmente estão em schema public.
-- Resultado: catálogo de tabelas/policies/grants/roles; nenhum dado de clientes.
-- Toda ausência de tabela, policy ou autorização exige revisão humana.
--
-- A transação é READ ONLY. Não adicionar instruções que alterem o catálogo.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';

-- 1) Identificação de sessão: registrar a origem com segurança, sem credenciais.
SELECT current_database() AS database_name,
       current_user AS audit_role,
       current_setting('server_version_num') AS postgres_version_num,
       current_setting('transaction_read_only') AS read_only;

-- 2) Matriz de tabelas descrita em docs/vigiaplus/alt085-operational-rls-migration.md.
-- Este inventário NÃO afirma que todas as tabelas existem na base consultada.
WITH expected(name) AS (
 VALUES
 ('reputation_targets'),('incidents'),('notification_channels'),('invoices'),
 ('subscriptions'),('memberships'),('tenant_features'),
 ('notification_deliveries'),('mcp_tokens'),('projects'),('mentions'),
 ('collection_runs'),('alerts'),('reviews'),('reports'),('incident_actions'),
 ('users'),('plans'),('llm_providers'),('notification_worker_runs'),
 ('audit_events'),('payment_events')
)
SELECT expected.name AS expected_table,
       c.oid IS NOT NULL AS found_in_public,
       c.relkind AS relation_kind,
       CASE WHEN c.oid IS NOT NULL THEN pg_get_userbyid(c.relowner) END AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       c.relacl::text AS raw_table_acl
FROM expected
LEFT JOIN pg_namespace n ON n.nspname='public'
LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=expected.name
ORDER BY expected.name;

-- 3) SQL exato das policies para revisão humana independente, inclusive
-- políticas PERMISSIVE (OR), RESTRICTIVE (AND), PUBLIC e de DML/ALL.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       p.polname AS policy_name,
       p.polpermissive AS permissive,
       p.polcmd AS command,
       ARRAY(
         SELECT CASE WHEN roles.oid=0 THEN 'PUBLIC'
                     ELSE pg_get_userbyid(roles.oid) END
         FROM unnest(p.polroles) roles(oid)
         ORDER BY roles.oid
       ) AS targets,
       pg_get_expr(p.polqual,p.polrelid) AS using_expression,
       pg_get_expr(p.polwithcheck,p.polrelid) AS with_check_expression
FROM pg_policy p
JOIN pg_class c ON c.oid=p.polrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
ORDER BY c.relname,p.polname;

-- 4) ACLs efetivas explícitas de tabelas (não só relacl::text), incluindo PUBLIC.
SELECT n.nspname AS schema_name,c.relname AS table_name,
       CASE WHEN acl.grantee=0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       pg_get_userbyid(acl.grantor) AS grantor,
       acl.privilege_type,acl.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN LATERAL aclexplode(
   CASE WHEN cardinality(c.relacl)=0 THEN NULL::aclitem[]
        ELSE COALESCE(c.relacl,acldefault('r',c.relowner)) END
) acl
WHERE n.nspname='public' AND c.relkind IN ('r','p')
ORDER BY c.relname,grantee,acl.privilege_type;

-- 5) ACLs por coluna e seus tipos (atenção a campos pessoais/financeiros).
SELECT c.relname AS table_name,a.attname AS column_name,
       format_type(a.atttypid,a.atttypmod) AS data_type,
       a.attacl::text AS column_acl,
       CASE WHEN acl.grantee=0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       pg_get_userbyid(acl.grantor) AS grantor,
       acl.privilege_type,acl.is_grantable
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN LATERAL aclexplode(
   CASE WHEN cardinality(a.attacl)>0 THEN a.attacl
        ELSE NULL::aclitem[] END
) acl ON true
WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY c.relname,a.attnum,acl.privilege_type;

-- 6) ACL de schema: namespace USAGE/CREATE para PUBLIC ou outros papéis.
SELECT n.nspname AS schema_name,
       pg_get_userbyid(n.nspowner) AS schema_owner,
       CASE WHEN acl.grantee=0 THEN 'PUBLIC'
            ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       pg_get_userbyid(acl.grantor) AS grantor,
       acl.privilege_type,acl.is_grantable
FROM pg_namespace n
CROSS JOIN LATERAL aclexplode(
  CASE WHEN cardinality(n.nspacl)=0 THEN NULL::aclitem[]
       ELSE COALESCE(n.nspacl,acldefault('n',n.nspowner)) END
) acl
WHERE n.nspname='public'
ORDER BY acl.grantee,acl.privilege_type;

-- 7) Flags de roles relevantes, sem ler credenciais ou pg_authid.
SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,
       rolcreatedb,rolcreaterole,rolinherit
FROM pg_roles
WHERE rolname !~ '^pg_' AND rolname NOT IN ('postgres')
ORDER BY rolname;

-- 8) Grafo de roles e SET ROLE, inclusive grants indiretos.
SELECT parent.rolname AS granted_role,member.rolname AS member,
       m.admin_option,m.inherit_option,m.set_option,
       pg_get_userbyid(m.grantor) AS granted_by
FROM pg_auth_members m
JOIN pg_roles parent ON parent.oid=m.roleid
JOIN pg_roles member ON member.oid=m.member
WHERE parent.rolname !~ '^pg_' AND member.rolname !~ '^pg_'
ORDER BY parent.rolname,member.rolname;

ROLLBACK;
