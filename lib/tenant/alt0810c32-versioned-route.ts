/**
 * ALT-08.10C.32: transactional read path explicitly opt-in in disposable CI.
 *
 * The gate is intentionally impossible to enable in an operational runtime.
 * Any later staging rollout needs its own reviewed credentials, schema, role,
 * permissions, and a separate change. No Neon migration is implied.
 */
import type { NextResponse } from 'next/server';

export const ALT0810C32 = {
  version: 'alt0810c32-versioned-route-v1',
  productionEnabled: false,
  stagingEnabled: false,
  operationalMigrationAuthorized: false,
} as const;

type Environment = Readonly<Record<string, string | undefined>>;

export function transactionalPermissionsMode(env: Environment): 'off' | 'disposable-ci' {
  const mode = env.ALT0810C32_MODE;
  if (mode === undefined || mode === '' || mode === 'off') return 'off';
  if (mode !== 'disposable-ci' ||
      env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' ||
      env.RUNNER_OS !== 'Linux' || env.ALT0810C32_EPHEMERAL !== '1' ||
      env.PGHOST !== '127.0.0.1' || env.PGPORT !== '5432' ||
      env.PGUSER !== 'vigia_ci' || env.PGDATABASE !== 'vigia_alt081_ci' ||
      env.PGPASSWORD !== 'isolated_ci_only' ||
      env.DATABASE_URL || env.RLS_DATABASE_URL ||
      env.NODE_ENV === 'production' || env.DEMO_MODE === '1') {
    throw Error('ALT0810C32_TRANSACTIONAL_MODE_NOT_AUTHORIZED');
  }
  return 'disposable-ci';
}

/**
 * Called only after the gate above is checked. Never accept SQL/role/tenant
 * from a request, and never import a PostgreSQL driver on the disabled path.
 * The CI runner installs pg without touching the production dependency graph.
 */
export async function disposableTransactionalPermissions(
  request: Request,
): Promise<NextResponse> {
  if (transactionalPermissionsMode(process.env) !== 'disposable-ci') {
    throw Error('ALT0810C32_TRANSACTIONAL_MODE_NOT_AUTHORIZED');
  }
  // A runtime require is deliberately confined to the disposable runner:
  // pg is not a production dependency and this path is disabled otherwise.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { Client } = require('pg') as {
    Client: new (configuration: Record<string, unknown>) => {
      connect(): Promise<void>;
      query(sql: string, params?: unknown[]): Promise<{
        rows: Record<string, unknown>[];
        rowCount: number | null;
      }>;
      end(): Promise<void>;
    };
  };
  const { NextResponse } = await import('next/server');
  const { verifySession, SESSION_COOKIE } = await import('@/lib/session');
  const { authorizedTenantRead } = await import('@/lib/tenant/alt0810c30-transactional-read');

  const raw = request.headers.get('cookie') ?? '';
  const cookie = raw.split(';').map(s => s.trim())
    .find(s => s.startsWith(SESSION_COOKIE + '='))
    ?.slice(SESSION_COOKIE.length + 1);
  const session = verifySession(cookie);
  const headers = { 'Cache-Control': 'no-store' };
  if (!session) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401, headers });

  const client = new Client({
    host: '127.0.0.1',
    port: 5432,
    user: 'vigia_ci',
    password: 'isolated_ci_only',
    database: 'vigia_alt081_ci',
    options: '-c search_path=alt0810c32_http',
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
  });
  await client.connect();
  try {
    // The client may not nominate a tenant. Multiple memberships fail closed.
    // The transactional gate verifies this membership again under SHARE locks.
    const membership = await client.query(
      'SELECT tenant_id FROM alt0810c32_http.memberships WHERE user_id=$1 ORDER BY tenant_id',
      [session.userId],
    );
    if (membership.rows.length !== 1) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403, headers });
    }
    const tenantId = Number(membership.rows[0].tenant_id);
    const decision = await authorizedTenantRead({
      db: client,
      cookie,
      tenantId,
      featureKey: 'reports_weekly',
      readerRole: 'alt0810c32_reader',
      read: async tx => {
        const result = await tx.query(
          'SELECT id FROM alt0810c32_http.evidence ORDER BY id',
        );
        return result.rows.map(r => Number(r.id));
      },
    });
    if (decision.status !== 200) {
      return NextResponse.json(
        { error: decision.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' },
        { status: decision.status, headers },
      );
    }
    return NextResponse.json({
      permissions: { tenantId },
      features: ['reports_weekly'],
      scopedEvidenceIds: decision.data,
    }, { headers });
  } finally {
    await client.end();
  }
}
