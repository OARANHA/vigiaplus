// Catálogo inicial idempotente para instalações que já possuem clientes.
// Não altera preços ou matrizes de direitos que já existem.
import type { DB } from '@/lib/db';
import { plans, planFeatures } from '@/lib/db/schema';
import { PLANS, PLAN_FEATURES } from '@/lib/tenant/catalog';

export async function ensureInitialPlanCatalog(db: DB): Promise<void> {
  for (const p of PLANS) {
    const inserted = await db.insert(plans).values({
      key: p.key, label: p.label, priceBrl: p.price_brl,
      aiQuotaBrl: p.ai_quota_brl, mentionsLimit: p.mentions_limit,
      retentionMonths: p.retention_months,
    }).onConflictDoNothing().returning({ key: plans.key });

    // Somente no primeiro cadastro. Alterações comerciais posteriores ficam intactas.
    if (inserted.length > 0) {
      for (const featureKey of PLAN_FEATURES[p.key] ?? []) {
        await db.insert(planFeatures).values({ planKey: p.key, featureKey })
          .onConflictDoNothing();
      }
    }
  }
}
