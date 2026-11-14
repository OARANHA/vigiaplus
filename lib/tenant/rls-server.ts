/**
 * ALT-08.3 — ponto de entrada server-only para o adaptador experimental Neon.
 * Não há rotas chamando esta função; não modifica getDb().
 */
import 'server-only';
import { resolveTenantContext } from './context';
import { withAuthenticatedClientRls } from './rls-runtime';
import { withNeonRlsPool } from './neon-rls-adapter';
import type { TenantSqlClient } from './rls-transaction';

/** Resolve identidade de sessão no servidor antes de obter conexão SQL. */
export async function withVerifiedNeonClientRls<T>(
  operation: (query: TenantSqlClient['query']) => Promise<T>,
): Promise<T> {
  const ctx = await resolveTenantContext({surface:'app'});
  // Roles/sistema/tenant inválidos são rejeitados antes de abrir pool ou conexão.
  return withNeonRlsPool(process.env, pool =>
    withAuthenticatedClientRls(ctx, pool, operation));
}
