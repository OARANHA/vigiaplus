/**
 * ALT-08.3 — integração experimental de contexto autenticado com transação RLS.
 *
 * NÃO conectado ao getDb() nem exportado como substituto do neon-http.
 * Aceita um TenantContext construído pelo servidor, nunca claims do request.
 * Este estágio só autoriza papéis de cliente na superfície app.
 * Owner, analyst, carteira/global e impersonação permanecem NO-GO.
 *
 * O chamador deve usar queries parametrizadas e tabelas com políticas RLS
 * habilitadas. GUCs customizados NÃO são barreira contra SQL arbitrário.
 */
import type { TenantContext } from './context';
import { withTenantRlsTransaction, validatedRlsTenantId, type TenantSqlPool, type TenantSqlClient } from './rls-transaction';

export function trustedRlsTenantForClient(ctx: TenantContext): number {
  if (!ctx || ctx.surface !== 'app' || ctx.system !== false ||
      (ctx.role !== 'client_admin' && ctx.role !== 'client_viewer') ||
      !Number.isSafeInteger(ctx.userId) || ctx.userId <= 0) {
    throw new Error('RLS_CLIENT_CONTEXT_REQUIRED');
  }
  return validatedRlsTenantId(ctx.tenantId);
}

/**
 * A verificação de membership é responsabilidade de resolveTenantContext().
 * Jamais chamar com contexto reconstruído de JSON, formulário ou cabeçalhos.
 */
export async function withAuthenticatedClientRls<T>(
  ctx: TenantContext,
  pool: TenantSqlPool,
  operation: (query: TenantSqlClient['query']) => Promise<T>,
): Promise<T> {
  return withTenantRlsTransaction(pool, trustedRlsTenantForClient(ctx), operation);
}
