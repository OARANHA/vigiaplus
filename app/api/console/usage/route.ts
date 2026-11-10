// Consumo verificado por cliente: janela de 30 dias, consultas agregadas no banco.
// Os dados não liberam/bloqueiam cotas; apenas mostram uso efetivamente registrado.
import { NextResponse } from 'next/server';
import { eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenants, plans, subscriptions, projects, mentions, llmUsage } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  const db = await getDb();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [allTenants, allPlans, allSubscriptions, mentionsByTenant, aiByTenant] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.name, status: tenants.status }).from(tenants),
    db.select().from(plans),
    db.select().from(subscriptions),
    db.select({
      tenantId: projects.tenantId,
      total: sql<number>`count(*)::integer`,
    }).from(mentions).innerJoin(projects, eq(mentions.projectId, projects.id))
      .where(gte(mentions.fetchedAt, since)).groupBy(projects.tenantId),
    db.select({
      tenantId: llmUsage.tenantId,
      total: sql<number>`coalesce(sum(${llmUsage.costBrl}), 0)::double precision`,
      requests: sql<number>`count(*)::integer`,
    }).from(llmUsage).where(gte(llmUsage.createdAt, since)).groupBy(llmUsage.tenantId),
  ]);
  const planMap = new Map(allPlans.map(p => [p.key, p]));
  const rows = allTenants.map(t => {
    const eligible = allSubscriptions.filter(s => s.tenantId === t.id &&
      (s.status === 'active' || (s.status === 'past_due' && s.graceUntil && s.graceUntil > new Date())) &&
      (!s.vigenciaAte || s.vigenciaAte >= new Date()));
    const sub = eligible.length === 1 ? eligible[0] : null;
    const plan = sub ? planMap.get(sub.planKey) : undefined;
    const mentioned = mentionsByTenant.find(m => m.tenantId === t.id);
    const usedAi = aiByTenant.find(m => m.tenantId === t.id);
    const mentionsUsed = Number(mentioned?.total ?? 0);
    const aiUsedBrl = Number(usedAi?.total ?? 0);
    return {
      tenantId: t.id, name: t.name, status: t.status,
      subscriptionStatus: eligible.length > 1 ? 'conflito' : sub?.status ?? 'sem_assinatura',
      planKey: sub?.planKey ?? null,
      mentions: { used: mentionsUsed, limit: plan?.mentionsLimit ?? null },
      ai: { usedBrl: Number(aiUsedBrl.toFixed(2)), limitBrl: plan?.aiQuotaBrl ?? null,
        calls: Number(usedAi?.requests ?? 0) },
      retentionMonths: plan?.retentionMonths ?? null,
    };
  });
  return NextResponse.json({
    window: { start: since.toISOString(), end: new Date().toISOString(), days: 30 },
    units: { mentions: 'coletadas na janela', ai: 'BRL registrado na janela' },
    quotasEnforced: false,
    clients: rows,
  });
}
