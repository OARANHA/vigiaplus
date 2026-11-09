/**
 * PostgreSQL RLS transaction gateway. No getDb, migrations or seeds.
 * Separate TENANT_DATABASE_URL must authenticate as restricted role.
 */
import { sql } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import type { DB } from '@/lib/db';
import type { TransactionProvider } from './scope';
import { assessRlsReadiness, type RlsRoleInfo, type RlsTableInfo, type RlsPolicyInfo } from './rls-preflight';

type Executor = Pick<DB, 'execute'>;

export function tenantConnectionConfig(env: Record<string, string | undefined>): string {
  if (!env.TENANT_DATABASE_URL || !env.DATABASE_URL) {
    throw new Error('RLS NO-GO: DATABASE_URL e TENANT_DATABASE_URL são obrigatórias');
  }
  let runtime: URL, owner: URL;
  try {
    runtime = new URL(env.TENANT_DATABASE_URL);
    owner = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('RLS NO-GO: URL PostgreSQL inválida');
  }
  if (!['postgres:', 'postgresql:'].includes(runtime.protocol)) {
    throw new Error('RLS NO-GO: TENANT_DATABASE_URL precisa ser PostgreSQL');
  }
  if (runtime.hostname === owner.hostname && runtime.pathname === owner.pathname &&
      runtime.port === owner.port && runtime.username === owner.username) {
    throw new Error('RLS NO-GO: a role do executor deve diferir da conta de migração/legado');
  }
  if (typeof WebSocket === 'undefined') {
    throw new Error('RLS NO-GO: WebSocket indisponível; exige runtime Node 22+');
  }
  return env.TENANT_DATABASE_URL;
}

/** Normaliza Neon HTTP, WebSocket e PGlite. Nunca assume sucesso se desconhecido. */
export function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  throw new Error('RLS NO-GO: retorno inesperado do catálogo');
}

/** Verifica a ROLE REAL na mesma transação em que SET LOCAL foi executado. */
export async function verifyRestrictedRuntimeRole(tx: Executor): Promise<void> {
  const roleRows = rowsOf(await tx.execute(sql.raw(
    "SELECT rolname AS role, rolsuper AS superuser, rolbypassrls AS bypass_rls FROM pg_roles WHERE rolname = current_user",
  )));
  const role = roleRows[0];
  if (!role) throw new Error('RLS NO-GO: role da transação desconhecida');
  const roleInfo: RlsRoleInfo = {
    role: String(role.role),
    superuser: role.superuser === true,
    bypassRls: role.bypass_rls === true,
  };
  const tables: RlsTableInfo[] = rowsOf(await tx.execute(sql.raw(
    "SELECT relname AS name, pg_get_userbyid(relowner) AS owner, relrowsecurity AS rls_enabled, relforcerowsecurity AS force_rls FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace",
  ))).map((r) => ({
    name: String(r.name), owner: String(r.owner),
    rlsEnabled: r.rls_enabled === true, forceRls: r.force_rls === true,
  }));
  const policies: RlsPolicyInfo[] = rowsOf(await tx.execute(sql.raw(
    "SELECT tablename AS table_name, qual AS qualification, with_check AS with_check FROM pg_policies WHERE schemaname = 'public'",
  ))).map((r) => ({
    table: String(r.table_name),
    qualification: typeof r.qualification === 'string' ? r.qualification : null,
    withCheck: typeof r.with_check === 'string' ? r.with_check : null,
  }));
  const errors = assessRlsReadiness({ role: roleInfo, tables, policies, connectionDriver: 'transactional' });
  if (errors.length) throw new Error('RLS NO-GO: ' + errors.length + ' problemas; primeiro: ' + errors[0]);
}

/** Pool por chamada: fechar mesmo se a transação falhar, sem contaminar outra request. */
export async function withTenantTransactionConnection<T>(
  callback: (provider: TransactionProvider<T>) => Promise<T>,
): Promise<T> {
  const url = tenantConnectionConfig(process.env);
  const { Pool } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-serverless');
  const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
  try {
    const db = drizzle({ client: pool, schema });
    return await callback(db as unknown as TransactionProvider<T>);
  } finally {
    await pool.end();
  }
}
