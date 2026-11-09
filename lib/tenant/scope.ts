/**
 * Escopo RLS de tenant: fail closed. NUNCA executar callbacks sem
 * transação ativa, pois SET LOCAL exige a mesma conexão e transação.
 * Importante: o driver Neon HTTP atualmente NÃO suporta essa garantia.
 * O helper não substitui filtros do ORM nem autoriza ativar RLS na produção.
 */
import { sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { withTenantTransactionConnection, verifyRestrictedRuntimeRole } from './transaction-gateway';

type Executor = Pick<DB, 'execute'>;
export type TransactionProvider<T> = {
  transaction?: (fn: (tx: Executor) => Promise<T>) => Promise<T>;
};

export class TenantScopeUnavailableError extends Error {
  constructor() {
    super('Escopo RLS indisponível: conexão não suporta transação interativa segura');
    this.name = 'TenantScopeUnavailableError';
  }
}

function unsupportedTransaction(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /transaction/i.test(msg) && /not support|unsupported|no transactions/i.test(msg);
}

/**
 * Unidade testável com conexão injetada. Só entrega tx após SET LOCAL e
 * propaga falhas, nunca tenta executar fn() fora da transação.
 */
export async function executeTenantScope<T>(
  connection: TransactionProvider<T>,
  tenantId: number,
  fn: (tx: Executor) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error('runInTenantScope exige tenantId inteiro positivo');
  }
  if (typeof connection.transaction !== 'function') throw new TenantScopeUnavailableError();

  try {
    return await connection.transaction(async (tx: Executor) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${tenantId}'`));
      return fn(tx);
    });
  } catch (error) {
    if (unsupportedTransaction(error)) throw new TenantScopeUnavailableError();
    throw error;
  }
}

export async function runInTenantScope<T>(
  tenantId: number,
  fn: (tx: Executor) => Promise<T>,
): Promise<T> {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production') {
    return withTenantTransactionConnection(async (db) =>
      executeTenantScope(db, tenantId, async (tx) => {
        await verifyRestrictedRuntimeRole(tx);
        return fn(tx);
      }),
    );
  }
  // Fallback somente PGlite local, sem conexão externa.
  const db = await getDb();
  return executeTenantScope(db as unknown as TransactionProvider<T>, tenantId, fn);
}
