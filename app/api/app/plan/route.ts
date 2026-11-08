// Portal do cliente: Meu plano + Avisos
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions, plans, notificationChannels, invoices } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireAction } from '@/lib/tenant/rbac';
import { enabledFeatures } from '@/lib/tenant/entitlements';
import { FEATURE_CATALOG } from '@/lib/tenant/catalog';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedTenantId = Number(url.searchParams.get('tenant_id')) || null;
  const ctx = await resolveTenantContext({ surface: 'app', requestedTenantId });
  requireAction(ctx, 'read_plan');

  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'Sem tenant ativo' }, { status: 400 });
  }

  const db = await getDb();
  const [sub] = await db.select().from(subscriptions)
    .where(eq(subscriptions.tenantId, ctx.tenantId));
  const [plan] = sub ? await db.select().from(plans).where(eq(plans.key, sub.planKey)) : [];
  const channels = await db.select().from(notificationChannels)
    .where(eq(notificationChannels.tenantId, ctx.tenantId));
  const tenantInvoices = await db.select().from(invoices)
    .where(eq(invoices.tenantId, ctx.tenantId));

  const included = await enabledFeatures(ctx);

  return NextResponse.json({
    plan: plan ?? null,
    subscription_status: sub?.status ?? 'none',
    included,
    catalog: FEATURE_CATALOG,
    avisos: {
      channels: channels.map((c) => ({
        channel: c.channel,
        destination: c.destination,
        active: c.active === 1,
        verified: c.verified === 1,
      })),
      // Historico legivel de avisos (placeholder: sera populado por worker-notify no H2)
      historico: [],
    },
    invoices: tenantInvoices.map((i) => ({
      id: i.id,
      amount: i.amountBrl,
      status: i.status,
      dueAt: i.dueAt,
    })),
  });
}
