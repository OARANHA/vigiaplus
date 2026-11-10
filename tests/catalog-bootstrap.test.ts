import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { ensureInitialPlanCatalog } from '../lib/db/ensure-plan-catalog';

test('bootstrap: catálogo é criado sem recriar recursos removidos nem alterar preços', async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE plans (
        key text PRIMARY KEY, label text NOT NULL, price_brl real,
        ai_quota_brl real NOT NULL DEFAULT 0,
        mentions_limit integer NOT NULL DEFAULT 5000,
        retention_months integer NOT NULL DEFAULT 1
      );
      CREATE TABLE plan_features (
        plan_key text NOT NULL REFERENCES plans(key),
        feature_key text NOT NULL,
        PRIMARY KEY (plan_key, feature_key)
      );
    `);
    const db = drizzle(client, { schema });
    await ensureInitialPlanCatalog(db);
    const initial = await db.select().from(schema.plans);
    assert.equal(initial.length, 4);
    const trial = await db.select().from(schema.planFeatures)
      .where(eq(schema.planFeatures.planKey, 'trial'));
    assert.ok(trial.some(x => x.featureKey === 'ai_enabled'));

    await db.update(schema.plans).set({ priceBrl: 123 })
      .where(eq(schema.plans.key, 'trial'));
    await db.delete(schema.planFeatures)
      .where(eq(schema.planFeatures.featureKey, 'ai_enabled'));
    await ensureInitialPlanCatalog(db);

    const [updated] = await db.select().from(schema.plans)
      .where(eq(schema.plans.key, 'trial'));
    assert.equal(updated.priceBrl, 123);
    const after = await db.select().from(schema.planFeatures)
      .where(eq(schema.planFeatures.planKey, 'trial'));
    assert.equal(after.some(x => x.featureKey === 'ai_enabled'), false);
  } finally {
    await client.close();
  }
});
