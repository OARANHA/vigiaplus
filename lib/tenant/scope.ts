/**
 * Escopo de tenant no BANCO (H1). Complementa — nao substitui — o filtro
 * em codigo de lib/tenant/context.ts: se uma query esquecer o WHERE, a policy
 * de RLS (migrations/00002_rls.sql) ainda barra o vazamento.
 *
 * O escopo vale apenas dentro da transacao (SET LOCAL), entao nunca vaza
 * para outra requisicao. Se o driver nao suportar transacao interativa
 * (Neon HTTP), cai para o filtro em codigo e AVISA — preferimos perder a
 * camada extra a deixar um SET de sessao persistindo num pool.
 */
import { sql } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';

type Executor = Pick<DB, 'execute'>;

function noTransactionSupport(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /transaction/i.test(msg) && /not support|unsupported|no transactions/i.test(msg);
}

/**
 * Executa `fn` com `app.tenant_id` definido na transacao.
 * Passe o executor recebido para as queries que devem ser protegidas por RLS.
 */
export async function runInTenantScope<T>(
  tenantId: number,
  fn: (tx?: Executor) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error('runInTenantScope exige tenantId inteiro positivo');
  }

  const db = await getDb();
  const transactional = db as unknown as {
    transaction?: (cb: (tx: Executor) => Promise<T>) => Promise<T>;
  };

  if (typeof transactional.transaction !== 'function') {
    console.warn('[vigia] driver sem transacao: RLS em modo passivo (filtro em codigo ativo)');
    return fn();
  }

  try {
    return await transactional.transaction(async (tx: Executor) => {
      await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${tenantId}'`));
      return fn(tx);
    });
  } catch (e) {
    if (noTransactionSupport(e)) {
      console.warn('[vigia] transacao indisponivel: RLS em modo passivo');
      return fn();
    }
    throw e;
  }
}
