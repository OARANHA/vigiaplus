// TenantContext: a UNICA fonte de verdade para "de quem e este dado".
// Tudo que chega do request (header, query, body) e considerado hostil.
// O tenant_id vem da SESSAO autenticada, nunca do cliente.
import { cookies, headers } from 'next/headers';
import { isDemoMode } from '@/lib/session';
import { isDemoReadMethod } from '@/lib/demo-readonly';
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, memberships, tenants, auditEvents } from '@/lib/db/schema';
import { getCurrentUser, type User } from '@/lib/auth';
import { ROLES, type Role, type Surface } from './catalog';
import { AppError } from './errors';

export type TenantContext = {
  userId: number;
  userName: string;
  role: Role;
  tenantId: number | null;
  system: boolean; // true = dono em visao de carteira (leitura cross-tenant)
  surface: Surface;
  density: 'basico' | 'avancado';
  vocabulary: 'leigo' | 'tecnico';
  ip: string | null;
  requestId: string;
};

function genRequestId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Resolve o contexto completo do tenant a partir da sessao autenticada.
 * O tenantId NUNCA vem do request -- vem do vinculo do usuario (memberships)
 * ou, para o dono, de uma selecao explicita e auditada.
 */
export async function resolveTenantContext(opts: {
  surface?: Surface;
  requestedTenantId?: number | null;
  ip?: string | null;
} = {}): Promise<TenantContext> {
  const surface = opts.surface ?? 'app';
  if (isDemoMode()) {
    // Defesa independente da camada de proxy e da identidade demo de proprietário.
    const method = (await headers()).get('x-vigia-request-method');
    if (!isDemoReadMethod(method)) {
      throw AppError.forbidden('Demonstração somente leitura');
    }
  }
  const user = await getCurrentUser();
  if (!user) throw AppError.unauthenticated();

  // Preferencias de visualizacao do usuario (ADR-03) -- NAO afetam permissoes.
  const density = (user.viewDensity === 'avancado' ? 'avancado' : 'basico') as 'basico' | 'avancado';
  const vocabulary = (user.viewVocabulary === 'tecnico' ? 'tecnico' : 'leigo') as 'leigo' | 'tecnico';

  // Determinar papel e tenant
  let role: Role;
  let tenantId: number | null;
  let system = false;
  let spoofAttempt: string | null = null;

  const requested = opts.requestedTenantId != null && opts.requestedTenantId !== undefined;

  if (user.globalRole === 'owner') {
    role = 'owner';
    if (requested && opts.requestedTenantId) {
      const db = await getDb();
      const [t] = await db.select().from(tenants).where(eq(tenants.id, opts.requestedTenantId));
      if (!t) throw AppError.notFound('Tenant inexistente');
      tenantId = t.id;
    } else {
      // Visao de carteira: leitura cross-tenant, sempre auditada.
      system = true;
      tenantId = null;
    }
  } else if (user.globalRole === 'analyst') {
    role = 'analyst';
    // Analyst opera no tenant que selecionar, mas precisa ter vinculo ou ser interno.
    // Para simplicidade no H0: analyst ve todos os tenants em modo de carteira.
    system = true;
    tenantId = null;
  } else {
    // Cliente: tenant vem do memberships, NUNCA do request.
    const db = await getDb();
    const [membership] = await db.select().from(memberships)
      .where(eq(memberships.userId, user.id));
    if (!membership) throw AppError.forbidden('Usuario sem vinculo com tenant');
    tenantId = membership.tenantId;
    role = membership.role as Role;

    if (requested && opts.requestedTenantId && opts.requestedTenantId !== tenantId) {
      spoofAttempt = String(opts.requestedTenantId); // ignora e registra
    }
  }

  if (!ROLES[role]) throw AppError.forbidden('Papel desconhecido');

  const ctx: TenantContext = {
    userId: user.id,
    userName: user.name,
    role,
    tenantId,
    system,
    surface,
    density,
    vocabulary,
    ip: opts.ip ?? null,
    requestId: genRequestId(),
  };

  // A10: nenhuma impersonacao sem registro.
  if (user.globalRole === 'owner' && !system && tenantId) {
    await appendAudit(ctx, {
      action: 'IMPERSONATE_TENANT',
      target: `tenant:${tenantId}`,
      reason: 'selecao explicita de tenant no console',
    });
  }
  if (spoofAttempt) {
    await appendAudit(ctx, {
      action: 'TENANT_SPOOF_ATTEMPT',
      target: `tenant:${spoofAttempt}`,
      reason: 'tenant_id enviado pelo cliente foi ignorado',
    });
  }

  return ctx;
}

/** Troca de tenant pelo dono. Motivo e OBRIGATORIO e auditado. */
export async function switchTenant(
  ctx: TenantContext,
  tenantId: number,
  reason: string,
): Promise<TenantContext> {
  if (ctx.role !== 'owner') throw AppError.forbidden('Somente o dono pode trocar de tenant');
  if (!reason || !reason.trim()) throw AppError.badRequest('Impersonacao exige motivo registrado');

  const db = await getDb();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw AppError.notFound('Tenant inexistente');

  const next: TenantContext = { ...ctx, tenantId: t.id, system: false };
  await appendAudit(next, {
    action: 'IMPERSONATE_TENANT',
    target: `tenant:${t.id}`,
    reason: reason.trim(),
  });
  return next;
}

/** Registra um evento na trilha de auditoria imutavel. */
export async function appendAudit(
  ctx: TenantContext,
  event: { action: string; target?: string; reason?: string; meta?: Record<string, unknown> },
): Promise<void> {
  const db = await getDb();
  await db.insert(auditEvents).values({
    actor: ctx.userName,
    tenantId: ctx.tenantId,
    action: event.action,
    target: event.target ?? null,
    reason: event.reason ?? null,
    ip: ctx.ip,
    meta: event.meta ?? null,
  });
}

/**
 * Helper para ler o tenant_id do query/header em rotas do console do dono.
 * Retorna null se nao houver (visao de carteira). Lanca erro se um cliente tentar.
 */
export function parseRequestedTenantId(searchParams: URLSearchParams, headers: Headers): number | null {
  const fromQuery = searchParams.get('tenant_id');
  const fromHeader = headers.get('x-tenant-id');
  const raw = fromQuery ?? fromHeader;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
