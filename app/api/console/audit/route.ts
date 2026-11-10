// Trilha de auditoria somente leitura: nunca retorna IP, metadados crus ou segredos.
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { auditEvents } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  const params = new URL(request.url).searchParams;
  const rawTenant = params.get('tenant_id');
  const tenantId = rawTenant === null ? null : Number(rawTenant);
  if (rawTenant !== null && (!Number.isSafeInteger(tenantId) || tenantId! <= 0)) {
    return NextResponse.json({ error: 'TENANT_INVALIDO' }, { status: 400 });
  }
  const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 50));
  const db = await getDb();
  const rows = await db.select({
    id: auditEvents.id,
    actor: auditEvents.actor,
    tenantId: auditEvents.tenantId,
    action: auditEvents.action,
    target: auditEvents.target,
    reason: auditEvents.reason,
    createdAt: auditEvents.createdAt,
  }).from(auditEvents)
    .where(tenantId === null ? undefined : eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.id)).limit(limit);
  return NextResponse.json({ events: rows, count: rows.length, limit });
}
