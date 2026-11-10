/**
 * Restrições comerciais aditivas. Nunca corrigir/apagar dados históricos
 * automaticamente. Se existir duplicidade legada, mantém leitura e suspende
 * somente mutações administrativas até reconciliação humana.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { AppError } from '@/lib/tenant/errors';

export const FEATURE_INDEX = 'vpx_tenant_feature_unique';
export const SUBSCRIPTION_INDEX = 'vpx_subscription_live_unique';

type Duplicate = { tenant_id: number; feature_key?: string; total: number };
export type CommercialConstraintReport = {
  featureIndex: boolean;
  subscriptionIndex: boolean;
  duplicateFeatures: Duplicate[];
  duplicateSubscriptions: Duplicate[];
};

export async function commercialConstraintReport(db: DB): Promise<CommercialConstraintReport> {
  const [features, subscriptions, indexes] = await Promise.all([
    db.execute(sql`SELECT tenant_id, feature_key, count(*)::integer AS total
      FROM tenant_features GROUP BY tenant_id, feature_key HAVING count(*) > 1
      ORDER BY tenant_id, feature_key LIMIT 50`),
    db.execute(sql`SELECT tenant_id, count(*)::integer AS total
      FROM subscriptions WHERE status IN ('active', 'past_due')
      GROUP BY tenant_id HAVING count(*) > 1 ORDER BY tenant_id LIMIT 50`),
    db.execute(sql`SELECT
      to_regclass('public.vpx_tenant_feature_unique') IS NOT NULL AS feature_ready,
      to_regclass('public.vpx_subscription_live_unique') IS NOT NULL AS subscription_ready`),
  ]);
  const index = indexes.rows[0] as {feature_ready:boolean;subscription_ready:boolean}|undefined;
  return {
    featureIndex: index?.feature_ready === true,
    subscriptionIndex: index?.subscription_ready === true,
    duplicateFeatures: features.rows as Duplicate[],
    duplicateSubscriptions: subscriptions.rows as Duplicate[],
  };
}

/** Invocado pelo bootstrap APÓS o schema: cria índices somente se os dados estiverem íntegros. */
export async function ensureCommercialConstraints(db: DB): Promise<CommercialConstraintReport> {
  const before = await commercialConstraintReport(db);
  if (!before.featureIndex && before.duplicateFeatures.length === 0) {
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS vpx_tenant_feature_unique
      ON tenant_features(tenant_id, feature_key)`);
  }
  if (!before.subscriptionIndex && before.duplicateSubscriptions.length === 0) {
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS vpx_subscription_live_unique
      ON subscriptions(tenant_id) WHERE status IN ('active', 'past_due')`);
  }
  return commercialConstraintReport(db);
}

export async function requireCommercialConstraint(db: DB, kind: 'feature' | 'subscription') {
  const result = await db.execute(sql`SELECT
    to_regclass('public.vpx_tenant_feature_unique') IS NOT NULL AS feature_ready,
    to_regclass('public.vpx_subscription_live_unique') IS NOT NULL AS subscription_ready`);
  const row = result.rows[0] as {feature_ready:boolean;subscription_ready:boolean}|undefined;
  const ok = kind === 'feature' ? row?.feature_ready : row?.subscription_ready;
  if (!ok) throw new AppError('COMMERCIAL_CONSTRAINT_PENDING', 409,
    'Proteção de unicidade pendente: resolva duplicidades antes de alterar contratos ou recursos');
}
