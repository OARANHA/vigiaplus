/**
 * npm run security:rls-check — inspeção SOMENTE LEITURA do banco real.
 * Usa conexão direta Neon HTTP para catálogo, SEM inicializar/seedar o app.
 * Bloqueia homologação enquanto o runtime HTTP não suportar SET LOCAL seguro.
 */
import { neon } from '@neondatabase/serverless';
import { assessRlsReadiness } from '../lib/tenant/rls-preflight';
import type { RlsRoleInfo, RlsTableInfo, RlsPolicyInfo } from '../lib/tenant/rls-preflight';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL ausente; informe a URL PostgreSQL da instância a auditar');
  const sql = neon(url);
  const [roleRows, tableRows, policyRows] = await Promise.all([
    sql`SELECT rolname AS role, rolsuper AS superuser, rolbypassrls AS bypass_rls
      FROM pg_roles WHERE rolname = current_user`,
    sql`SELECT relname AS name, pg_get_userbyid(relowner) AS owner,
      relrowsecurity AS rls_enabled, relforcerowsecurity AS force_rls
      FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace`,
    sql`SELECT tablename AS table_name, qual AS qualification, with_check AS with_check
      FROM pg_policies WHERE schemaname = 'public'`,
  ]);
  const r = roleRows[0] as Record<string, unknown> | undefined;
  if (!r) throw new Error('Não foi possível identificar a role da conexão');
  const role: RlsRoleInfo = {
    role: String(r.role),
    superuser: r.superuser === true,
    bypassRls: r.bypass_rls === true,
  };
  const tables: RlsTableInfo[] = tableRows.map((t) => ({
    name: String(t.name), owner: String(t.owner), rlsEnabled: t.rls_enabled === true,
    forceRls: t.force_rls === true,
  }));
  const policies: RlsPolicyInfo[] = policyRows.map((p) => ({
    table: String(p.table_name),
    qualification: typeof p.qualification === 'string' ? p.qualification : null,
    withCheck: typeof p.with_check === 'string' ? p.with_check : null,
  }));
  // ATENÇÃO: o runtime atual usa Drizzle neon-http. Não confiar numa env
  // declarativa para fingir um driver com transação que não foi implantado.
  const issues = assessRlsReadiness({ role, tables, policies, connectionDriver: 'neon-http' });
  if (issues.length) {
    console.error(`RLS NO-GO: ${issues.length} impeditivo(s) para homologação:\n${issues.map((m) => '- ' + m).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('RLS: catálogo sem impeditivos detectados; ainda executar testes de isolamento entre tenants.');
  }
}

main().catch((e) => {
  console.error('RLS NO-GO:', e instanceof Error ? e.message.split('\n')[0] : 'erro não identificado');
  process.exitCode = 1;
});
