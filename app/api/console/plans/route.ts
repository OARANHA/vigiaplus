// Gestão comercial do proprietário: catálogo persistido de planos e matriz de recursos.
// Alterações em planos contratados são recusadas para preservar contratos existentes.
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { plans, planFeatures, subscriptions } from '@/lib/db/schema';
import { FEATURE_CATALOG, FEATURE_KEYS } from '@/lib/tenant/catalog';
import { resolveTenantContext, appendAudit } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { AppError } from '@/lib/tenant/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Draft = {
  key: string; label: string; priceBrl: number | null;
  aiQuotaBrl: number; mentionsLimit: number; retentionMonths: number;
  features: string[]; reason: string;
};
function validate(input: unknown): Draft {
  if (!input || typeof input !== 'object') throw AppError.badRequest('Dados do plano inválidos');
  const v = input as Record<string, unknown>;
  const key = typeof v.key === 'string' ? v.key.trim() : '';
  const label = typeof v.label === 'string' ? v.label.trim() : '';
  const reason = typeof v.reason === 'string' ? v.reason.trim() : '';
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(key)) throw AppError.badRequest('Identificador: 2–40 caracteres minúsculos');
  if (label.length < 2 || label.length > 80) throw AppError.badRequest('Nome: 2–80 caracteres');
  if (reason.length < 5 || reason.length > 300) throw AppError.badRequest('Informe motivo de 5–300 caracteres');
  const integer = (name: string, max: number, min: number) => {
    const n = v[name];
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max) {
      throw AppError.badRequest('Limite inválido: ' + name);
    }
    return n;
  };
  const priceBrl = v.priceBrl === null ? null : v.priceBrl;
  if (priceBrl !== null && (typeof priceBrl !== 'number' || !Number.isFinite(priceBrl)
     || priceBrl < 0 || priceBrl > 10_000_000)) throw AppError.badRequest('Preço inválido');
  const aiQuotaBrl = v.aiQuotaBrl;
  if (typeof aiQuotaBrl !== 'number' || !Number.isFinite(aiQuotaBrl)
    || aiQuotaBrl < 0 || aiQuotaBrl > 1_000_000) throw AppError.badRequest('Cota de IA inválida');
  const features = v.features;
  if (!Array.isArray(features) || features.some(k => typeof k !== 'string' || !FEATURE_KEYS.has(k)))
    throw AppError.badRequest('Matriz de recursos inválida');
  const uniqueFeatures = [...new Set(features as string[])];
  return {
    key, label, priceBrl: priceBrl as number | null, aiQuotaBrl,
    mentionsLimit: integer('mentionsLimit', 1_000_000_000, 1),
    retentionMonths: integer('retentionMonths', 120, 1),
    features: uniqueFeatures, reason,
  };
}
function failure(err: unknown) {
  const e = err instanceof AppError ? err : AppError.badRequest('Falha ao salvar plano');
  return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
}

export async function GET() {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  const db = await getDb();
  const [items, grants, active] = await Promise.all([
    db.select().from(plans),
    db.select().from(planFeatures),
    db.select({ planKey: subscriptions.planKey }).from(subscriptions),
  ]);
  return NextResponse.json({
    catalog: FEATURE_CATALOG,
    plans: items.map(p => ({
      ...p,
      features: grants.filter(f => f.planKey === p.key).map(f => f.featureKey),
      inUse: active.some(s => s.planKey === p.key),
    })),
  });
}

export async function POST(request: Request) {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  try {
    const p = validate(await request.json());
    const db = await getDb();
    const [exists] = await db.select({ key: plans.key }).from(plans).where(eq(plans.key, p.key)).limit(1);
    if (exists) return NextResponse.json({ error: 'PLAN_EXISTS', message: 'Identificador já cadastrado' }, { status: 409 });
    const features = sql`ARRAY[${sql.join(p.features.map(key => sql`${key}`), sql`, `)}]::text[]`;
    // Uma instrução SQL atômica: plano + matriz, sem gravação parcial.
    await db.execute(sql`
      WITH created AS (
        INSERT INTO plans (key, label, price_brl, ai_quota_brl, mentions_limit, retention_months)
        VALUES (${p.key}, ${p.label}, ${p.priceBrl}, ${p.aiQuotaBrl}, ${p.mentionsLimit}, ${p.retentionMonths})
        RETURNING key
      )
      INSERT INTO plan_features (plan_key, feature_key)
      SELECT created.key, unnest(${features}) FROM created
    `);
    await appendAudit(ctx, { action: 'PLAN_CREATED', target: 'plan:' + p.key, reason: p.reason });
    return NextResponse.json({ ok: true, key: p.key }, { status: 201 });
  } catch (err) { return failure(err); }
}

export async function PUT(request: Request) {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  try {
    const p = validate(await request.json());
    const db = await getDb();
    const [exists] = await db.select({ key: plans.key }).from(plans).where(eq(plans.key, p.key)).limit(1);
    if (!exists) throw AppError.notFound('Plano não encontrado');
    const [linked] = await db.select({ id: subscriptions.id }).from(subscriptions)
      .where(eq(subscriptions.planKey, p.key)).limit(1);
    if (linked) return NextResponse.json({
      error: 'PLAN_IN_USE', message: 'Plano vinculado a contrato. Crie um novo plano para preservar o histórico.',
    }, { status: 409 });
    const features = sql`ARRAY[${sql.join(p.features.map(key => sql`${key}`), sql`, `)}]::text[]`;
    // Atualiza apenas as diferenças: evita conflito de unicidade entre DELETE/INSERT
    // de uma mesma chave num único comando PostgreSQL.
    const result = await db.execute(sql`
      WITH updated AS (
        UPDATE plans SET label=${p.label}, price_brl=${p.priceBrl},
        ai_quota_brl=${p.aiQuotaBrl}, mentions_limit=${p.mentionsLimit},
        retention_months=${p.retentionMonths}
        WHERE key=${p.key} AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE plan_key=${p.key})
        RETURNING key
      ),
      removed AS (
        DELETE FROM plan_features
        WHERE plan_key IN (SELECT key FROM updated)
          AND NOT (feature_key = ANY(${features}))
        RETURNING feature_key
      ),
      added AS (
        INSERT INTO plan_features (plan_key, feature_key)
        SELECT updated.key, desired.feature_key
        FROM updated CROSS JOIN unnest(${features}) AS desired(feature_key)
        WHERE NOT EXISTS (
          SELECT 1 FROM plan_features existing
          WHERE existing.plan_key = updated.key AND existing.feature_key = desired.feature_key
        )
        ON CONFLICT DO NOTHING
        RETURNING feature_key
      )
      SELECT EXISTS (SELECT 1 FROM updated) AS changed
    `);
    if (result.rows?.[0]?.changed !== true) {
      return NextResponse.json({ error: 'PLAN_IN_USE',
        message: 'Plano indisponível para edição ou vinculado a um contrato.' }, { status: 409 });
    }
    await appendAudit(ctx, { action: 'PLAN_UPDATED', target: 'plan:' + p.key, reason: p.reason });
    return NextResponse.json({ ok: true, key: p.key });
  } catch (err) { return failure(err); }
}
