/**
 * Preflight read-only para role runtime RLS usando Pool WebSocket separado.
 * Não usa getDb(), não faz seed, DDL ou migrations. Falha fechado.
 */
import { Pool } from '@neondatabase/serverless';
import { tenantConnectionConfig } from '../lib/tenant/transaction-gateway';
import { assessRlsReadiness, type RlsRoleInfo, type RlsTableInfo, type RlsPolicyInfo } from '../lib/tenant/rls-preflight';

async function main() {
  const connectionString = tenantConnectionConfig(process.env);
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const client = await pool.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN READ ONLY');
    inTransaction = true;
    await client.query("SET LOCAL app.tenant_id = '1'");
    const roleRows = (await client.query(
      "SELECT rolname AS role, rolsuper AS superuser, rolbypassrls AS bypass_rls FROM pg_roles WHERE rolname = current_user",
    )).rows;
    const tableRows = (await client.query(
      "SELECT relname AS name, pg_get_userbyid(relowner) AS owner, relrowsecurity AS rls_enabled, relforcerowsecurity AS force_rls FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace",
    )).rows;
    const policyRows = (await client.query(
      "SELECT tablename AS table_name, qual AS qualification, with_check AS with_check FROM pg_policies WHERE schemaname = 'public'",
    )).rows;
    const raw = roleRows[0];
    if (!raw) throw new Error('Role PostgreSQL atual não identificada');
    const role: RlsRoleInfo = {
      role: String(raw.role),
      superuser: raw.superuser === true,
      bypassRls: raw.bypass_rls === true,
    };
    const tables: RlsTableInfo[] = tableRows.map((r) => ({
      name: String(r.name), owner: String(r.owner),
      rlsEnabled: r.rls_enabled === true, forceRls: r.force_rls === true,
    }));
    const policies: RlsPolicyInfo[] = policyRows.map((r) => ({
      table: String(r.table_name),
      qualification: typeof r.qualification === 'string' ? r.qualification : null,
      withCheck: typeof r.with_check === 'string' ? r.with_check : null,
    }));
    const errors = assessRlsReadiness({ role, tables, policies, connectionDriver: 'transactional' });
    if (errors.length) {
      console.error('RLS NO-GO: ' + errors.length + ' problemas:\n' + errors.map((x) => '- ' + x).join('\n'));
      process.exitCode = 1;
    } else {
      console.log('RLS preflight: catálogo consistente e transação WebSocket funcional; validar E2E entre tenants e rotas legadas.');
    }
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
}
main().catch((error) => {
  console.error('RLS NO-GO:', error instanceof Error ? error.message : 'Falha desconhecida');
  process.exitCode = 1;
});
