// Console do dono: lista de tenants
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { tenants, subscriptions } from '@/lib/db/schema';
import { resolveTenantContext, parseRequestedTenantId } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx = await resolveTenantContext({ surface: 'console', requestedTenantId });
  requireOwner(ctx);

  const db = await getDb();
  const allTenants = await db.select().from(tenants);
  const allSubs = await db.select().from(subscriptions);

  return NextResponse.json({
    tenants: allTenants.map((t) => {
      const sub = allSubs.find((s) => s.tenantId === t.id && s.status === 'active');
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        cnpj: t.cnpj,
        domain: t.domain,
        plan: t.planKey,
        status: t.status,
        locale: t.locale,
        subscription: sub ? { planKey: sub.planKey, status: sub.status } : null,
      };
    }),
    current: ctx.tenantId,
  });
}
