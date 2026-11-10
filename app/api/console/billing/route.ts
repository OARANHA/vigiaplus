import { NextResponse } from 'next/server';
import { desc, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  tenants, subscriptions, plans, invoices, paymentEvents, llmUsage,
} from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { gatewayStatus } from '@/lib/billing/gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const brl = (n: number) => Number(n.toFixed(2));

/** Console financeiro do dono: MRR, inadimplencia, custo de IA e eventos. */
export async function GET() {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);

  const db = await getDb();
  const [allTenants, subs, allPlans, openInvoices, events, usage] = await Promise.all([
    db.select().from(tenants),
    db.select().from(subscriptions),
    db.select().from(plans),
    db.select().from(invoices).where(inArray(invoices.status, ['open', 'overdue', 'processing'])),
    db.select().from(paymentEvents).orderBy(desc(paymentEvents.receivedAt)).limit(20),
    db.select().from(llmUsage),
  ]);

  const planByKey = new Map(allPlans.map((p) => [p.key, p]));
  const dueToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const subsByTenant = new Map<number, typeof subs>();
  for (const subscription of subs) {
    const existing = subsByTenant.get(subscription.tenantId) ?? [];
    existing.push(subscription);
    subsByTenant.set(subscription.tenantId, existing);
  }

  const carteira = allTenants.map((t) => {
    const activeSubs = (subsByTenant.get(t.id) ?? []).filter(s => s.status === 'active');
    // Havendo contratos simultâneos, nunca selecionar silenciosamente o último.
    const sub = activeSubs.length === 1 ? activeSubs[0] : undefined;
    const plan = sub ? planByKey.get(sub.planKey) : undefined;
    const inadimplente = openInvoices
      .filter(i => i.tenantId === t.id && (
        i.status === 'overdue' || (i.status === 'open' && i.dueAt != null && i.dueAt < dueToday)
      ))
      .reduce((sum, i) => sum + i.amountBrl, 0);
    const custoIa = usage
      .filter((u) => u.tenantId === t.id)
      .reduce((sum, u) => sum + u.costBrl, 0);
    return {
      id: t.id,
      nome: t.name,
      plano: sub?.planKey ?? t.planKey,
      preco: brl(plan?.priceBrl ?? 0),
      status: activeSubs.length > 1 ? 'conflito' : sub?.status ?? 'none',
      gateway: sub?.gateway ?? 'manual',
      contratoConflitante: activeSubs.length > 1,
      vigenciaAte: sub?.vigenciaAte ?? null,
      inadimplencia: brl(inadimplente),
      custoIa: brl(custoIa),
    };
  });

  const mrr = carteira
    .filter((c) => c.status === 'active')
    .reduce((sum, c) => sum + c.preco, 0);
  const inadimplencia = carteira.reduce((sum, c) => sum + c.inadimplencia, 0);
  const custoIa = carteira.reduce((sum, c) => sum + c.custoIa, 0);

  return NextResponse.json({
    resumo: {
      mrr: brl(mrr),
      clientesAtivos: carteira.filter((c) => c.status === 'active').length,
      inadimplencia: brl(inadimplencia),
      custoIa: brl(custoIa),
      margem: brl(mrr - custoIa),
      faturasEmAberto: openInvoices.length,
    },
    carteira,
    eventos: events.map((e) => ({
      id: e.id, gateway: e.gateway, type: e.type,
      amount: e.amountBrl, tenantId: e.tenantId, receivedAt: e.receivedAt,
    })),
    gateways: gatewayStatus(),
  });
}
