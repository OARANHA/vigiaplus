// Contratos manuais exclusivamente pelo proprietário. Não cria fatura, pagamento ou assinatura no gateway.
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { subscriptions, tenants } from '@/lib/db/schema';
import { activateManualContractAtomic } from '@/lib/db/commercial-writes';
import { AppError } from '@/lib/tenant/errors';
import { resolveTenantContext } from '@/lib/tenant/context';
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
  try {
    const db = await getDb();
    const result = await activateManualContractAtomic(db, {
      userId: ctx.userId, name: ctx.userName, ip: ctx.ip,
    }, Number(tenantId), planKey, reason);
    return NextResponse.json({
      ok: true, tenantId: result.tenantId, subscriptionId: result.subscriptionId,
      planKey, gateway: 'manual', charged: false,
    });
  } catch (err) {
    const error = err instanceof AppError ? err
      : new AppError('CONTRACT_WRITE_FAILED', 409, 'Não foi possível ativar contrato. Confira a integridade comercial.');
    return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
  }
}
