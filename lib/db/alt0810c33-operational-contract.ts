/**
 * ALT-08.10C.33 — reviewable operational transport contracts, NOT enabled.
 *
 * Never use pool.query for transactional tenant reads. The callback receives
 * exactly one checked-out client. A failed cleanup poisons the connection:
 * it must be discarded, never returned to the shared pool.
 */
import type { TxQuery } from '../tenant/alt0810c30-transactional-read';

export const ALT0810C33 = Object.freeze({
  version: 'alt0810c33-dedicated-pool-and-privilege-preflight-v1',
  stagingEnabled: false,
  productionEnabled: false,
  schemaMigrationAuthorized: false,
  operationalRlsAuthorized: false,
});

export type DedicatedClient = TxQuery & {
  release(discard?: boolean): void;
};
export type DedicatedPool = {
  connect(): Promise<DedicatedClient>;
};
export type QualifiedEvidence = Readonly<{
  schema: string;
  table: string;
  readerRole: string;
  /** Name of the login whose privileges are checked (not chosen by HTTP). */
  executorRole: string;
}>;

function identifier(name: string): boolean {
  return /^[a-z][a-z0-9_]{0,62}$/.test(name);
}

function assertNames(scope: QualifiedEvidence): void {
  for (const value of Object.values(scope)) {
    if (!identifier(value)) throw Error('ALT0810C33_IDENTIFIER_DENIED');
  }
}

function isTrue(value: unknown): boolean {
  return value === true || value === 't';
}

/**
 * A positive result is evidence for a disposable fixture only. An operational
 * deployment also requires independently approved migrations, least-privilege
 * ownership, network/TLS, credential rotation and failover rehearsals.
 *
 * The probe reads catalog metadata as the restricted executor. The executor
 * must be non-superuser/NOBYPASSRLS; reader must be NOLOGIN/NOBYPASSRLS,
 * granted only SELECT on evidence and no access to auth/billing tables.
 */
export async function preflightTenantRls(
  db: TxQuery, scope: QualifiedEvidence,
): Promise<void> {
  assertNames(scope);
  const result = await db.query(`
    SELECT
      current_user = $1 AS correct_executor,
      NOT er.rolsuper AND NOT er.rolbypassrls AND er.rolcanlogin AS safe_executor,
      NOT rr.rolsuper AND NOT rr.rolbypassrls AND NOT rr.rolcanlogin AS safe_reader,
      pg_has_role($1, $2, 'MEMBER') AS reader_granted,
      c.relrowsecurity AND c.relforcerowsecurity AS force_rls,
      c.relowner <> rr.oid AS owner_separated,
      has_schema_privilege($2,$3,'USAGE') AS schema_usage,
      has_table_privilege($2,format('%I.%I',$3,$4),'SELECT') AS evidence_read,
      NOT has_table_privilege($2,format('%I.%I',$3,$4),'INSERT') AS no_insert,
      NOT has_table_privilege($2,format('%I.%I',$3,$4),'UPDATE') AS no_update,
      NOT has_table_privilege($2,format('%I.%I',$3,$4),'DELETE') AS no_delete,
      EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname=$3 AND p.tablename=$4
          AND p.cmd='SELECT'
          AND (p.roles @> ARRAY[$2]::name[])
      ) AS select_policy,
      NOT EXISTS (
        SELECT 1 FROM unnest(ARRAY[
          'users','memberships','tenants','subscriptions',
          'tenant_features','plan_features'
        ]) AS auth_table(name)
        JOIN pg_class ac ON ac.relname=auth_table.name
        JOIN pg_namespace an ON an.oid=ac.relnamespace AND an.nspname=$3
        WHERE has_table_privilege($2,ac.oid,'SELECT')
           OR has_table_privilege($2,ac.oid,'INSERT')
           OR has_table_privilege($2,ac.oid,'UPDATE')
           OR has_table_privilege($2,ac.oid,'DELETE')
      ) AS no_auth_access
    FROM pg_roles er
    JOIN pg_roles rr ON rr.rolname=$2
    JOIN pg_namespace n ON n.nspname=$3
    JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=$4
    WHERE er.rolname=$1
      AND c.relkind IN ('r','p')
  `, [scope.executorRole,scope.readerRole,scope.schema,scope.table]);
  if (result.rows.length !== 1 ||
      Object.values(result.rows[0]).some(value => !isTrue(value))) {
    throw Error('ALT0810C33_RLS_PREFLIGHT_DENIED');
  }
}

/**
 * Ensures that one client is checked out for the WHOLE authenticated read.
 * On any thrown error, aborts an unfinished transaction before release.
 * If ROLLBACK itself fails, the client is destroyed rather than reused.
 * The read callback MUST end its transaction on the same client; the extra
 * ROLLBACK here is idempotent when no transaction remains active.
 */
export async function withDedicatedTenantClient<T>(
  pool: DedicatedPool,
  read: (client: TxQuery) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discard = false;
  try {
    const result = await read(client);
    try {
      await client.query('ROLLBACK');
    } catch {
      discard = true;
      throw Error('ALT0810C33_CLEANUP_FAILED');
    }
    return result;
  } catch (error) {
    if (!discard) {
      try { await client.query('ROLLBACK'); }
      catch { discard = true; }
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
