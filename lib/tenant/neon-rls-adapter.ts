/**
 * ALT-08.3 — adapter Neon WebSocket para sessões RLS interativas.
 *
 * Não substitui getDb() e não é invocado por nenhuma rota. CI/experimental
 * somente, sem migração de políticas ou queries automáticas.
 * O contrato da transação é provido por lib/tenant/rls-transaction.ts.
 */
import { Pool } from '@neondatabase/serverless';
import type { TenantSqlPool, TenantSqlClient } from './rls-transaction';

export type NeonRlsEnvironment = {
  VIGIA_RLS_MODE?: string;
  NODE_ENV?: string;
  CI?: string;
  GITHUB_ACTIONS?: string;
  RLS_DATABASE_URL?: string;
  DATABASE_URL?: string;
};
export function validateNeonRlsEnvironment(env: NeonRlsEnvironment): string {
  if (env.VIGIA_RLS_MODE !== 'ci-experimental' ||
      env.NODE_ENV === 'production' ||
      env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' ||
      !env.RLS_DATABASE_URL || env.DATABASE_URL) {
    throw new Error('RLS_NEON_ADAPTER_DISABLED');
  }
  const url = new URL(env.RLS_DATABASE_URL);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('RLS_NEON_DATABASE_URL_INVALID');
  }
  if (!url.hostname.endsWith('.neon.tech')) {
    throw new Error('RLS_NEON_HOST_NOT_ALLOWED');
  }
  return env.RLS_DATABASE_URL;
}

/**
 * Cria Pool dentro do escopo de uma única requisição/operação e fecha sempre.
 * Não guarda Pool em globalThis nem permite reuso entre handlers serverless.
 * Node 22+ possui WebSocket nativo; o driver utiliza conexões via WebSocket.
 */
export async function withNeonRlsPool<T>(
  env: NeonRlsEnvironment,
  operation: (pool: TenantSqlPool) => Promise<T>,
): Promise<T> {
  const url = validateNeonRlsEnvironment(env);
  const pool = new Pool({ connectionString: url, max: 2 });
  try {
    const adapter: TenantSqlPool = {
      async connect(): Promise<TenantSqlClient> {
        const client = await pool.connect();
        return {
          async query(statement, params) {
            const result = await client.query(statement, params ? [...params] : []);
            return {rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount};
          },
          release() {client.release()},
        };
      },
    };
    return await operation(adapter);
  } finally {
    await pool.end();
  }
}
