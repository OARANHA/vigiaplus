// Entitlements: o que este contrato pode usar, resolvido no SERVIDOR.
// Ordem: override explícito do tenant -> feature do plano -> negação.
import { err } from './errors.js';
import { FEATURE_KEYS } from './catalog.js';
import { appendAudit } from './audit.js';

export function featureState(store, ctx, key, now = new Date()) {
  if (!FEATURE_KEYS.has(key)) {
    return { enabled: false, reason: 'feature_desconhecida', source: 'catalog' };
  }

  // Equipe interna opera a plataforma; não sofre corte de contrato de cliente.
  if (ctx.role === 'owner' || ctx.role === 'analyst') {
    return { enabled: true, reason: 'equipe_interna', source: 'internal' };
  }

  const overrides = store
    .all('tenant_features', ctx)
    .filter((o) => o.feature_key === key);

  // Negação explícita sempre vence.
  const denied = overrides.find((o) => o.enabled === false || o.enabled === 0);
  if (denied) {
    return {
      enabled: false,
      reason: denied.reason ?? 'desabilitado_por_contrato',
      source: 'override',
    };
  }

  const granted = overrides.find(
    (o) =>
      (o.enabled === true || o.enabled === 1) &&
      (!o.expires_at || new Date(o.expires_at) > now),
  );
  if (granted) {
    return { enabled: true, reason: granted.reason ?? 'liberado_por_override', source: 'override' };
  }

  const subscription = store.all('subscriptions', ctx).find((s) => s.status === 'active');
  if (!subscription) {
    return { enabled: false, reason: 'sem_assinatura_ativa', source: 'billing' };
  }

  const included = store
    .allRaw('plan_features')
    .some((p) => p.plan_key === subscription.plan_key && p.feature_key === key);
  if (included) {
    return { enabled: true, reason: 'incluso_no_plano', source: 'plano', plan: subscription.plan_key };
  }

  return {
    enabled: false,
    reason: 'nao_incluso_no_plano',
    source: 'plano',
    plan: subscription.plan_key,
  };
}

export function requireFeature(store, ctx, key) {
  const state = featureState(store, ctx, key);
  if (!state.enabled) {
    throw err.feature(`Recurso "${key}" não habilitado (${state.reason})`);
  }
  return state;
}

export function enabledFeatures(store, ctx) {
  return store
    .allRaw('feature_catalog')
    .filter((f) => featureState(store, ctx, f.key).enabled)
    .map((f) => f.key);
}

/** Override administrativo: motivo obrigatório, expiração opcional, sempre auditado. */
export function setTenantFeature(store, ctx, tenantId, input) {
  if (ctx.role !== 'owner') throw err.forbidden('Operação reservada ao dono');
  if (!FEATURE_KEYS.has(input.feature_key)) throw err.badRequest('Feature desconhecida');
  if (!input.reason || !String(input.reason).trim()) {
    throw err.badRequest('Override exige motivo');
  }
  const target = { ...ctx, tenantId, system: false };
  const existing = store
    .all('tenant_features', target)
    .find((o) => o.feature_key === input.feature_key);

  const row = existing ?? {
    id: store.nextId(),
    tenant_id: tenantId,
    feature_key: input.feature_key,
  };
  row.enabled = input.enabled !== false;
  row.reason = String(input.reason).trim();
  row.expires_at = input.expires_at ?? null;
  row.updated_by = ctx.userId;
  row.updated_at = new Date().toISOString();
  if (!existing) store.insertRaw('tenant_features', row);

  appendAudit(store, target, {
    action: row.enabled ? 'FEATURE_ENABLED' : 'FEATURE_DISABLED',
    target: `tenant:${tenantId}:${input.feature_key}`,
    reason: row.reason,
  });
  return row;
}
