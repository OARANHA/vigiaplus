/**
 * ALT-08.3 — primitive transacional RLS, NÃO conectada ao runtime.
 *
 * Aceita apenas pools PostgreSQL que fixem uma conexão durante toda a
 * transação. Jamais usar com neon-http, que não tem sessão transacional
 * interativa, nem aceitar tenantId de headers/body/query.
 *
 * A autorização de tenant acontece ANTES desta chamada, via TenantContext.
 * A role PostgreSQL tem de ser não privilegiada e as políticas RLS reais
 * precisam estar instaladas separadamente. Este helper, isoladamente, NÃO
 * certifica isolamento SQL no produto.
 */
export type TenantSqlResult = { rows: Record<string, unknown>[]; rowCount: number | null };
export type TenantSqlClient = {
  query(sql: string, params?: readonly unknown[]): Promise<TenantSqlResult>;
  release(): void;
};
export type TenantSqlPool = { connect(): Promise<TenantSqlClient> };

export function validatedRlsTenantId(tenantId: number | null | undefined): number {
  if (typeof tenantId !== 'number' || !Number.isSafeInteger(tenantId)
      || tenantId <= 0) {
    throw new Error('RLS_TENANT_SCOPE_REQUIRED');
  }
  return tenantId;
}

/**
 * A função callback executa somente na conexão dedicada com app.tenant_id
 * definido via SET LOCAL/set_config(..., true) dentro de BEGIN/COMMIT.
 * ROLLBACK no erro; release mesmo se BEGIN, COMMIT ou ROLLBACK falhar.
 * Não retornar a conexão para uso fora deste escopo.
 */
export async function withTenantRlsTransaction<T>(
  pool: TenantSqlPool,
  trustedTenantId: number,
  operation: (query: TenantSqlClient['query']) => Promise<T>,
): Promise<T> {
  const tenantId = validatedRlsTenantId(trustedTenantId);
  const client = await pool.connect();
  let started = false;
  try {
    await client.query('BEGIN');
    started = true;
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true)",
      [String(tenantId)],
    );
    const result = await operation((statement, params) => client.query(statement, params));
    await client.query('COMMIT');
    started = false;
    return result;
  } catch (error) {
    if (started) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
    }
    throw error;
  } finally {
    client.release();
  }
}
