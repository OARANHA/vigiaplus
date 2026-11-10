/**
 * Escritas comerciais críticas em UMA instrução PostgreSQL por ação.
 * Suporta Neon HTTP (sem transação interativa) e PGlite.
 * RETURNING conecta CTEs sem depender da ordem de execução.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { AppError } from '@/lib/tenant/errors';
import { requireCommercialConstraint } from './commercial-constraints';

export type CommercialActor = { userId: number; name: string; ip?: string|null };

export async function activateManualContractAtomic(
  db: DB, actor: CommercialActor, tenantId: number, planKey: string, reason: string,
): Promise<{ subscriptionId: number; tenantId: number }> {
  await requireCommercialConstraint(db, 'subscription');
  const result = await db.execute(sql`
    WITH eligible AS (
      SELECT t.id FROM tenants t
      JOIN plans p ON p.key = ${planKey}
      WHERE t.id = ${tenantId}
        AND t.status IN ('active', 'pending')
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions previous
          WHERE previous.tenant_id = t.id
            AND (previous.gateway <> 'manual' OR previous.gateway_id IS NOT NULL)
        )
        AND (SELECT count(*) FROM subscriptions conflicting
          WHERE conflicting.tenant_id = t.id AND conflicting.status IN ('active','past_due')) <= 1
    ),
    saved AS (
      INSERT INTO subscriptions (tenant_id, plan_key, gateway, status, vigencia_ate, grace_until, updated_at)
      SELECT id, ${planKey}, 'manual', 'active', NULL, NULL, now() FROM eligible
      ON CONFLICT (tenant_id) WHERE status IN ('active','past_due')
      DO UPDATE SET plan_key=EXCLUDED.plan_key, status='active', gateway='manual',
        vigencia_ate=NULL, grace_until=NULL, updated_at=now()
      WHERE subscriptions.gateway='manual' AND subscriptions.gateway_id IS NULL
      RETURNING id, tenant_id
    ),
    activated AS (
      UPDATE tenants SET plan_key=${planKey}, status='active'
      WHERE id IN (SELECT tenant_id FROM saved)
      RETURNING id
    ),
    audited AS (
      INSERT INTO audit_events (actor, tenant_id, action, target, reason, ip)
      SELECT ${actor.name}, id, 'CONTRACT_MANUAL_ACTIVATION',
        ${'tenant:' + tenantId + ':plan:' + planKey}, ${reason}, ${actor.ip ?? null}
      FROM activated RETURNING tenant_id
    )
    SELECT saved.id AS subscription_id, saved.tenant_id
    FROM saved JOIN audited ON audited.tenant_id=saved.tenant_id
  `);
  const row = result.rows[0] as {subscription_id:number;tenant_id:number}|undefined;
  if (!row) throw new AppError('CONTRACT_CONFLICT', 409,
    'Ativação recusada: contrato gerenciado, histórico incompatível, cliente inativo ou plano inexistente');
  return { subscriptionId: row.subscription_id, tenantId: row.tenant_id };
}

export async function setFeatureOverrideAtomic(
  db: DB,
  actor: CommercialActor,
  input: { tenantId:number; featureKey:string; enabled:boolean;
    reason:string; expiresAt:Date|null },
): Promise<void> {
  await requireCommercialConstraint(db, 'feature');
  const result = await db.execute(sql`
    WITH eligible AS (
      SELECT id FROM tenants WHERE id=${input.tenantId}
    ),
    saved AS (
      INSERT INTO tenant_features
        (tenant_id, feature_key, enabled, reason, expires_at, updated_by, updated_at)
      SELECT id, ${input.featureKey}, ${input.enabled ? 1 : 0},
        ${input.reason}, ${input.expiresAt}, ${actor.userId}, now()
      FROM eligible
      ON CONFLICT (tenant_id,feature_key)
      DO UPDATE SET enabled=EXCLUDED.enabled, reason=EXCLUDED.reason,
        expires_at=EXCLUDED.expires_at, updated_by=EXCLUDED.updated_by, updated_at=now()
      RETURNING tenant_id
    ),
    audited AS (
      INSERT INTO audit_events (actor,tenant_id,action,target,reason,ip)
      SELECT ${actor.name}, tenant_id, ${input.enabled ? 'FEATURE_ENABLED':'FEATURE_DISABLED'},
        ${'tenant:' + input.tenantId + ':' + input.featureKey},
        ${input.reason}, ${actor.ip ?? null}
      FROM saved RETURNING id
    )
    SELECT count(*)::integer AS count FROM audited
  `);
  const row = result.rows[0] as {count:number}|undefined;
  if (Number(row?.count ?? 0) !== 1)
    throw AppError.notFound('Organização inexistente ou não disponível');
}
