/**
 * ALT-08.10C.34 — disposable-only proof contracts; never opt-in for live traffic.
 *
 * A "SELECT" policy merely existing in pg_policies is NOT proof of isolation:
 * permissive policies OR together, including PUBLIC and inherited role policies.
 * The externally reviewed hash MUST be pinned by a separately authorized
 * manifest before this can ever be considered for operational use.
 */
import { createHash } from 'node:crypto';
import {
  preflightTenantRls, withDedicatedTenantClient,
  type DedicatedPool, type QualifiedEvidence,
} from './alt0810c33-operational-contract';
import type { TxQuery } from '../tenant/alt0810c30-transactional-read';

export const ALT0810C34 = Object.freeze({
  version: 'alt0810c34-exclusive-policy-and-read-only-transaction-v1',
  stagingEnabled: false,
  productionEnabled: false,
  operationalRlsAuthorized: false,
  reviewedPolicyManifestAvailable: false,
});

export type ExclusivePolicyContract = QualifiedEvidence & Readonly<{
  expectedPolicyName: string;
  /** SHA-256 of pg_get_expr(polqual, polrelid), pinned after human review. */
  expectedUsingSha256: string;
}>;

const safeIdentifier = (s: string): boolean => /^[a-z][a-z0-9_]{0,62}$/.test(s);
export const policyExpressionDigest = (expression: string): string =>
  createHash('sha256').update(expression, 'utf8').digest('hex');

/**
 * Fail closed if ANY other policy exists on the relation (even an UPDATE/ALL
 * or PUBLIC policy), if its single SELECT policy changes, or if the relation
 * or namespace gains a PUBLIC DML/USAGE grant. Exact catalog text is
 * intentionally version sensitive: drift requires an explicit new review.
 * This is an audit of one approved fixture, not a general SQL proof system.
 */
export async function preflightExclusiveTenantPolicy(
  db: TxQuery, scope: ExclusivePolicyContract,
): Promise<void> {
  if (!safeIdentifier(scope.expectedPolicyName) ||
      !/^[0-9a-f]{64}$/.test(scope.expectedUsingSha256)) {
    throw Error('ALT0810C34_POLICY_CONTRACT_DENIED');
  }
  await preflightTenantRls(db, scope);
  const policies = await db.query(`
    SELECT p.polname::text AS policy_name,
           p.polcmd::text AS policy_command,
           p.polpermissive AS is_permissive,
           p.polroles = ARRAY[rr.oid]::oid[] AS only_reader,
           p.polwithcheck IS NULL AS without_write_check,
           pg_get_expr(p.polqual,p.polrelid) AS using_expression,
           NOT EXISTS (
             SELECT 1 FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
             WHERE a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
           ) AS no_public_table_access,
           NOT EXISTS (
             SELECT 1 FROM pg_attribute col
             CROSS JOIN LATERAL aclexplode(COALESCE(col.attacl,'{}'::aclitem[])) a
             WHERE col.attrelid=c.oid AND col.attnum>0
               AND NOT col.attisdropped AND a.grantee=0
               AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
           ) AS no_public_column_access,
           NOT EXISTS (
             SELECT 1 FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
             WHERE a.grantee=0 AND a.privilege_type='USAGE'
           ) AS no_public_schema_usage
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_roles rr ON rr.rolname=$3
    JOIN pg_policy p ON p.polrelid=c.oid
    WHERE n.nspname=$1 AND c.relname=$2
    ORDER BY p.polname
  `, [scope.schema,scope.table,scope.readerRole]);
  if (policies.rows.length!==1) throw Error('ALT0810C34_POLICY_DRIFT_DENIED');
  const policy=policies.rows[0];
  if (policy.policy_name!==scope.expectedPolicyName ||
      policy.policy_command!=='r' ||
      policy.is_permissive!==true ||
      policy.only_reader!==true ||
      policy.without_write_check!==true ||
      policy.no_public_table_access!==true ||
      policy.no_public_column_access!==true ||
      policy.no_public_schema_usage!==true ||
      typeof policy.using_expression!=='string' ||
      policyExpressionDigest(policy.using_expression)!==scope.expectedUsingSha256) {
    throw Error('ALT0810C34_POLICY_DRIFT_DENIED');
  }
}

export type DisposableTenantScope = Readonly<{
  tenantId: number;
  /** Trusted, server-selected role only; never supplied by an HTTP caller. */
  readerRole: string;
}>;

function assertSelectOnly(sql: string): void {
  // Deliberately much narrower than SQL: no batch statements, comments,
  // transaction control, CTE DML, SET ROLE, or set_config/GUC mutation.
  // This is defense in depth for trusted, statically reviewed SQL, NOT a
  // substitute for parameter binding or an SQL parser.
  if (!/^\s*SELECT\s/i.test(sql) ||
      /;|--|\/\*|\*\//.test(sql) ||
      /\b(?:set_config|pg_terminate_backend|dblink_exec|lo_export|pg_notify)\s*\(/i.test(sql)) {
    throw Error('ALT0810C34_QUERY_DENIED');
  }
}

/**
 * Candidate read-only lifecycle for an ALREADY AUTHORIZED tenant scope.
 * The caller is responsible for verified session/membership/entitlement.
 * This helper is NOT wired into any route or driver; it deliberately does
 * not resolve identity and MUST NOT be used on the basis of HTTP params.
 *
 * The wrapper owns BEGIN READ ONLY + ROLLBACK; the callback cannot COMMIT.
 */
export async function withDisposableScopedRead<T>(
  pool: DedicatedPool,
  scope: DisposableTenantScope,
  read: (query: TxQuery) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(scope.tenantId) || scope.tenantId<=0 ||
      !safeIdentifier(scope.readerRole)) {
    throw Error('ALT0810C34_SCOPE_DENIED');
  }
  return withDedicatedTenantClient(pool,async client=>{
    await client.query('BEGIN READ ONLY');
    await client.query(`SET LOCAL ROLE "${scope.readerRole}"`);
    await client.query('SELECT set_config($1,$2,true)',
      ['app.tenant_id',String(scope.tenantId)]);
    const guarded:TxQuery={
      async query(sql,params) {
        assertSelectOnly(sql);
        return client.query(sql,params);
      },
    };
    return read(guarded);
  });
}
