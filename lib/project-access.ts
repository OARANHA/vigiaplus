import { eq, or, and, inArray } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { projects, memberships, tenants } from '@/lib/db/schema';

// Quem ve quais projetos -- a regra de scoping extraida em um modulo SEM
// import de next/headers, para que os testes de integracao possam verifica-la
// contra um banco isolado (correcao P0 do audit: a ausencia de um projeto
// acessivel nunca se transforma em operacao global).
//
// VigiaPlus (multi-tenant): o tenant_id e a fronteira. O dono ve todos os
// projetos (visao de carteira). Analyst ve todos. Cliente so ve os projetos
// do seu tenant.

export type ScopedUser = { id: number; role: string; globalRole?: string | null; tenantId?: number | null };

export function visibleProjectsFor(db: DB, user: ScopedUser | null) {
  if (!user) return db.select().from(projects).where(eq(projects.id, -1)); // sem acesso

  // Dono ou analista: ve todos os projetos (visao de carteira).
  if (user.globalRole === 'owner' || user.globalRole === 'analyst' || user.role === 'admin') {
    return db.select().from(projects).orderBy(projects.id);
  }

  // Cliente com tenant: so projetos do seu tenant.
  if (user.tenantId) {
    return db.select().from(projects)
      .where(eq(projects.tenantId, user.tenantId))
      .orderBy(projects.id);
  }

  // Compatibilidade: sem tenant_id no ScopedUser, usa o modelo antigo
  // (ownerId ou visibility='shared'). Mantem os 245 testes originais verdes.
  const cond = or(eq(projects.ownerId, user.id), eq(projects.visibility, 'shared'));
  return db.select().from(projects).where(cond).orderBy(projects.id);
}

/**
 * Versao async que resolve o tenant do usuario via memberships.
 * Necessaria porque o ScopedUser sincrono pode nao ter tenantId.
 */
export async function visibleProjectsForAsync(db: DB, user: ScopedUser | null) {
  if (!user) return [];
  if (user.globalRole === 'owner' || user.globalRole === 'analyst' || user.role === 'admin') {
    return db.select().from(projects).orderBy(projects.id);
  }
  if (user.tenantId) {
    return db.select().from(projects)
      .where(eq(projects.tenantId, user.tenantId))
      .orderBy(projects.id);
  }
  // Resolver tenant via memberships
  const memberRows = await db.select().from(memberships).where(eq(memberships.userId, user.id));
  if (memberRows.length === 0) return [];
  const tenantIds = memberRows.map((m) => m.tenantId);
  return db.select().from(projects)
    .where(inArray(projects.tenantId, tenantIds))
    .orderBy(projects.id);
}
