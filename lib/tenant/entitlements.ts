// Entitlements: o que este contrato pode usar, resolvido no SERVIDOR.
// Ordem: assinatura válida -> override vigente -> direitos persistidos do plano -> negação.
import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenantFeatures, subscriptions, planFeatures, tenants } from '@/lib/db/schema';
import { FEATURE_KEYS } from './catalog';
import { AppError } from './errors';
import type { TenantContext } from './context';
import { setFeatureOverrideAtomic } from '@/lib/db/commercial-writes';

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

  // Cliente pendente, suspenso ou inativo não deve ter acesso por contrato ou exceção.
  const [organization] = await db.select({ status: tenants.status })
    .from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
  if (!organization || organization.status !== 'active') {
    return { enabled: false, reason: 'cliente_inativo_ou_pendente', source: 'billing' };
  }

  // Overrides do tenant
  const overrides = await db.select().from(tenantFeatures)
    .where(eq(tenantFeatures.tenantId, ctx.tenantId));

  const featureOverrides = overrides.filter((o) => o.featureKey === key);

  // Negacao explicita sempre vence.
  const now = new Date();
  // Um bloqueio vencido não pode continuar negando acesso.
  const vigente = (o: typeof featureOverrides[number]) =>
    !o.expiresAt || new Date(o.expiresAt).getTime() > now.getTime();
  const currentOverrides = featureOverrides.filter(vigente);
  // Dados duplicados são ambíguos: falhar fechado até saneamento/migração UNIQUE.
  if (currentOverrides.length > 1) {
    return { enabled: false, reason: 'permissoes_duplicadas', source: 'override' };
  }
  const denied = currentOverrides.find((o) => o.enabled === 0);

  // Estado financeiro dirige o contrato (ADR-07 + dunning H3).
  // Nunca confiamos no frontend: o gateway so muda `status`, e o entitlement
  // reage aqui. `past_due` mantem acesso ate graceUntil (3 dias de aviso,
  // 7 dias de suspensao — ver scripts/workers/dunning.ts).
  const subs = await db.select().from(subscriptions)
    .where(eq(subscriptions.tenantId, ctx.tenantId));
  // `now` ja foi declarado acima para validar a expiracao dos overrides.
  const validSubscriptions = subs.filter((s) =>
    (s.status === 'active' || (s.status === 'past_due' && s.graceUntil && new Date(s.graceUntil) > now)) &&
    (!s.vigenciaAte || new Date(s.vigenciaAte) >= now),
  );
  // Mais de uma assinatura válida é um estado ambíguo: negar até conciliação.
  if (validSubscriptions.length > 1) {
    return { enabled: false, reason: 'contratos_conflitantes', source: 'billing' };
  }
  const sub = validSubscriptions[0];
  const inGrace = sub?.status === 'past_due' ? sub : undefined;
  const active = sub?.status === 'active' ? sub : undefined;

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

  // Negação explícita e vigente prevalece após confirmar assinatura.
  if (denied) {
    return { enabled: false, reason: denied.reason ?? 'desabilitado_por_contrato', source: 'override' };
  }
  const granted = featureOverrides.find((o) => o.enabled === 1 && vigente(o));
  if (granted) {
    return { enabled: true, reason: granted.reason ?? 'liberado_por_override', source: 'override', plan: sub.planKey };
  }

  // Única fonte da matriz de direitos: plan_features persistida, não constantes TS.
  const planRows = await db.select({ featureKey: planFeatures.featureKey }).from(planFeatures)
    .where(eq(planFeatures.planKey, sub.planKey));
  if (planRows.some((row) => row.featureKey === key)) {
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
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw AppError.badRequest('Cliente inválido');
  if (typeof input.enabled !== 'boolean') throw AppError.badRequest('Estado do recurso inválido');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 300)
    throw AppError.badRequest('Override exige motivo de até 300 caracteres');
  // Input da UI é uma data civil; a exceção vence ao final desse dia (Brasília).
  const expirationInput = typeof input.expires_at === 'string' ? input.expires_at : null;
  const expiresAt: Date | null = expirationInput
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(expirationInput)
      ? expirationInput + 'T23:59:59.999-03:00' : expirationInput)
    : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
    throw AppError.badRequest('A expiração deve ser uma data futura');
  }

  const db = await getDb();
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw AppError.notFound('Cliente inexistente');
  // Diagnóstico explícito para bases legadas: não reconciliar nem apagar sem autorização.
  const existing = await db.select().from(tenantFeatures)
    .where(and(eq(tenantFeatures.tenantId, tenantId), eq(tenantFeatures.featureKey, input.feature_key)));
  if (existing.length > 1) throw AppError.badRequest('Permissões duplicadas: concilie os registros antes de alterar');

  // Upsert + evento de auditoria são um único comando atômico no PostgreSQL.
  await setFeatureOverrideAtomic(db, {
    userId: ctx.userId, name: ctx.userName, ip: ctx.ip,
  }, {
    tenantId, featureKey: input.feature_key, enabled: input.enabled,
    reason: input.reason.trim(), expiresAt,
  });
}
