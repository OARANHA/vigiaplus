// Entitlements: o que este contrato pode usar, resolvido no SERVIDOR.
// Ordem: override explicito do tenant -> feature do plano -> negacao.
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenantFeatures, subscriptions, planFeatures, tenants } from '@/lib/db/schema';
import { FEATURE_KEYS, PLAN_FEATURES } from './catalog';
import { AppError } from './errors';
import type { TenantContext } from './context';
import { appendAudit } from './context';

export type FeatureState = {
  enabled: boolean;
  reason: string;
  source: 'catalog' | 'internal' | 'override' | 'billing' | 'plano';
  plan?: string;
};

export async function featureState(ctx: TenantContext, key: string): Promise<FeatureState> {
  if (!FEATURE_KEYS.has(key)) {
    return { enabled: false, reason: 'feature_desconhecida', source: 'catalog' };
  }

  // Equipe interna opera a plataforma; nao sofre corte de contrato de cliente.
  // MAS: quando o dono seleciona um tenant explicitamente (impersonacao),
  // ele deve ver as features COMO o cliente as ve — senao nunca valida um override.
  const isImpersonating = ctx.role === 'owner' && !ctx.system && ctx.tenantId != null;
  if ((ctx.role === 'owner' || ctx.role === 'analyst') && !isImpersonating) {
    return { enabled: true, reason: 'equipe_interna', source: 'internal' };
  }

  if (!ctx.tenantId) {
    return { enabled: false, reason: 'sem_tenant', source: 'billing' };
  }

  const db = await getDb();

  // Overrides do tenant
  const overrides = await db.select().from(tenantFeatures)
    .where(eq(tenantFeatures.tenantId, ctx.tenantId));

  const featureOverrides = overrides.filter((o) => o.featureKey === key);

  // Negacao explicita sempre vence.
  const denied = featureOverrides.find((o) => o.enabled === 0);
  if (denied) {
    return { enabled: false, reason: denied.reason ?? 'desabilitado_por_contrato', source: 'override' };
  }

  // Liberacao explicita com expiracao.
  const now = new Date();
  const granted = featureOverrides.find((o) => o.enabled === 1 && (!o.expiresAt || new Date(o.expiresAt) > now));
  if (granted) {
    return { enabled: true, reason: granted.reason ?? 'liberado_por_override', source: 'override' };
  }

  // Estado financeiro dirige o contrato (ADR-07 + dunning H3).
  // Nunca confiamos no frontend: o gateway so muda `status`, e o entitlement
  // reage aqui. `past_due` mantem acesso ate graceUntil (3 dias de aviso,
  // 7 dias de suspensao — ver scripts/workers/dunning.ts).
  const subs = await db.select().from(subscriptions)
    .where(eq(subscriptions.tenantId, ctx.tenantId));
  // `now` ja foi declarado acima para validar a expiracao dos overrides.
  const active = subs.find((s) => s.status === 'active');
  const inGrace = subs.find(
    (s) => s.status === 'past_due' && s.graceUntil && new Date(s.graceUntil) > now,
  );
  const sub = active ?? inGrace;

  if (!sub) {
    const hasVencida = subs.some((s) => s.status === 'past_due');
    return {
      enabled: false,
      reason: hasVencida ? 'pagamento_atrasado' : 'sem_assinatura_ativa',
      source: 'billing',
    };
  }

  // Vigencia expirada sem renovacao registrada tambem bloqueia.
  if (sub.vigenciaAte && new Date(sub.vigenciaAte) < now) {
    return { enabled: false, reason: 'vigencia_expirada', source: 'billing' };
  }

  // Feature inclusa no plano?
  const planFeaturesList = PLAN_FEATURES[sub.planKey] ?? [];
  if (planFeaturesList.includes(key)) {
    return {
      enabled: true,
      reason: inGrace && !active ? 'incluso_no_plano_em_carencia' : 'incluso_no_plano',
      source: 'plano',
      plan: sub.planKey,
    };
  }

  return { enabled: false, reason: 'nao_incluso_no_plano', source: 'plano', plan: sub.planKey };
}

export async function requireFeature(ctx: TenantContext, key: string): Promise<FeatureState> {
  const state = await featureState(ctx, key);
  if (!state.enabled) {
    throw AppError.feature(`Recurso "${key}" nao habilitado (${state.reason})`);
  }
  return state;
}

export async function enabledFeatures(ctx: TenantContext): Promise<string[]> {
  const result: string[] = [];
  for (const f of Array.from(FEATURE_KEYS)) {
    const state = await featureState(ctx, f);
    if (state.enabled) result.push(f);
  }
  return result;
}

/** Override administrativo: motivo obrigatorio, expiracao opcional, sempre auditado. */
export async function setTenantFeature(
  ctx: TenantContext,
  tenantId: number,
  input: { feature_key: string; enabled: boolean; reason: string; expires_at?: string | null },
): Promise<void> {
  if (ctx.role !== 'owner') throw AppError.forbidden('Operacao reservada ao dono');
  if (!FEATURE_KEYS.has(input.feature_key)) throw AppError.badRequest('Feature desconhecida');
  if (!input.reason || !input.reason.trim()) throw AppError.badRequest('Override exige motivo');

  const db = await getDb();
  const target: TenantContext = { ...ctx, tenantId, system: false };
  const expiresAt: Date | null = input.expires_at ? new Date(input.expires_at) : null;

  // Upsert: se ja existe, atualiza; senao, insere.
  const existing = await db.select().from(tenantFeatures)
    .where(and(eq(tenantFeatures.tenantId, tenantId), eq(tenantFeatures.featureKey, input.feature_key)));

  if (existing.length > 0) {
    await db.update(tenantFeatures).set({
      enabled: input.enabled ? 1 : 0,
      reason: input.reason.trim(),
      expiresAt,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    }).where(eq(tenantFeatures.id, existing[0].id));
  } else {
    await db.insert(tenantFeatures).values({
      tenantId,
      featureKey: input.feature_key,
      enabled: input.enabled ? 1 : 0,
      reason: input.reason.trim(),
      expiresAt,
      updatedBy: ctx.userId,
      updatedAt: new Date(),
    });
  }

  await appendAudit(target, {
    action: input.enabled ? 'FEATURE_ENABLED' : 'FEATURE_DISABLED',
    target: `tenant:${tenantId}:${input.feature_key}`,
    reason: input.reason.trim(),
  });
}
