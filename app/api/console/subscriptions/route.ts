// Contratos manuais exclusivamente pelo proprietário. Não cria fatura, pagamento ou assinatura no gateway.
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { plans, subscriptions, tenants } from '@/lib/db/schema';
import { resolveTenantContext, appendAudit } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  const db = await getDb();
  const [clients, contracts] = await Promise.all([
    db.select({ id: tenants.id, name: tenants.name, status: tenants.status, planKey: tenants.planKey }).from(tenants),
    db.select().from(subscriptions),
  ]);
  return NextResponse.json({
    contracts: clients.map(t => ({
      tenantId: t.id, tenantName: t.name, tenantStatus: t.status,
      registeredPlan: t.planKey,
      subscriptions: contracts.filter(s => s.tenantId === t.id).map(s => ({
        id: s.id, planKey: s.planKey, status: s.status, gateway: s.gateway,
        vigenciaAte: s.vigenciaAte, graceUntil: s.graceUntil,
      })),
    })),
  });
}

export async function POST(request: Request) {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'JSON_INVALIDO' }, { status: 400 }); }
  const tenantId = body.tenantId;
  const planKey = typeof body.planKey === 'string' ? body.planKey : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!Number.isSafeInteger(tenantId) || Number(tenantId) <= 0 ||
      !/^[a-z][a-z0-9_-]{1,39}$/.test(planKey) ||
      reason.length < 5 || reason.length > 300 || body.manualApproval !== true) {
    return NextResponse.json({ error: 'INVALID_CONTRACT', message: 'Identifique cliente, plano, motivo e aprovação manual explícita' }, { status: 400 });
  }
  const id = Number(tenantId);
  const db = await getDb();
  const [client, plan, existing] = await Promise.all([
    db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, id)).limit(1),
    db.select({ key: plans.key }).from(plans).where(eq(plans.key, planKey)).limit(1),
    db.select().from(subscriptions).where(eq(subscriptions.tenantId, id)),
  ]);
  if (!client.length || !plan.length) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  // Nenhum contrato de gateway pode ser convertido automaticamente em manual.
  if (existing.some(s => s.gateway !== 'manual' || s.gatewayId) || existing.length > 1) {
    return NextResponse.json({ error: 'MANAGED_CONTRACT', message: 'Contrato gerenciado por gateway ou com histórico ambíguo; revisão manual necessária' }, { status: 409 });
  }
  // Ativação manual explícita; NÃO é confirmação de pagamento.
  if (existing[0]) {
    await db.update(subscriptions).set({
      planKey, status: 'active', gateway: 'manual',
      vigenciaAte: null, graceUntil: null, updatedAt: new Date(),
    }).where(eq(subscriptions.id, existing[0].id));
  } else {
    await db.insert(subscriptions).values({
      tenantId: id, planKey, status: 'active', gateway: 'manual',
    });
  }
  await db.update(tenants).set({ planKey, status: 'active' }).where(eq(tenants.id, id));
  await appendAudit(ctx, { action: 'CONTRACT_MANUAL_ACTIVATION',
    target: 'tenant:' + id + ':plan:' + planKey, reason });
  return NextResponse.json({ ok: true, tenantId: id, planKey, gateway: 'manual', charged: false });
}
