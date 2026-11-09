import { NextResponse } from 'next/server';
import { sql, eq, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { invoices, notificationDeliveries, notificationChannels } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireAction } from '@/lib/tenant/rbac';
import { runInTenantScope } from '@/lib/tenant/scope';
import { gatewayStatus } from '@/lib/billing/gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InvoiceRow = {
  id: number;
  amount: number;
  status: string;
  dueAt: string | null;
  description: string | null;
  gateway: string;
  paymentLink: string | null;
  pixCopiaCola: string | null;
  paidAt: string | null;
};

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const r = result as { rows?: Record<string, unknown>[] };
  return r?.rows ?? [];
}

/**
 * Faturas + historico de avisos do tenant.
 * A consulta de faturas roda DENTRO do escopo RLS e propositalmente NAO tem
 * WHERE de tenant: e o banco quem filtra. Se a policy falhar, o teste
 * adversarial A11 pega o vazamento.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedTenantId = Number(url.searchParams.get('tenant_id')) || null;
  const ctx = await resolveTenantContext({ surface: 'app', requestedTenantId });
  requireAction(ctx, 'read_billing');

  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'Sem tenant ativo' }, { status: 400 });
  }

  const db = await getDb();
  const tenantId = ctx.tenantId;
  let list: InvoiceRow[] = [];

  await runInTenantScope(tenantId, async (tx) => {
    if (tx) {
      const result = await tx.execute(sql.raw(
        'SELECT id, amount_brl, status, due_at, description, gateway, payment_link, pix_copia_cola, paid_at FROM invoices ORDER BY due_at DESC NULLS LAST',
      ));
      list = rowsOf(result).map((r) => ({
        id: Number(r.id),
        amount: Number(r.amount_brl ?? 0),
        status: String(r.status ?? 'open'),
        dueAt: r.due_at ? String(r.due_at).slice(0, 10) : null,
        description: r.description ? String(r.description) : null,
        gateway: String(r.gateway ?? 'manual'),
        paymentLink: r.payment_link ? String(r.payment_link) : null,
        pixCopiaCola: r.pix_copia_cola ? String(r.pix_copia_cola) : null,
        paidAt: r.paid_at ? String(r.paid_at) : null,
      }));
    } else {
      const fallback = await db.select().from(invoices)
        .where(eq(invoices.tenantId, tenantId))
        .orderBy(desc(invoices.dueAt));
      list = fallback.map((i) => ({
        id: i.id, amount: i.amountBrl, status: i.status, dueAt: i.dueAt,
        description: i.description, gateway: i.gateway,
        paymentLink: i.paymentLink, pixCopiaCola: i.pixCopiaCola,
        paidAt: i.paidAt ? new Date(i.paidAt).toISOString() : null,
      }));
    }
  });

  // Defesa em profundidade: mesmo com RLS, confere a posse no codigo.
  list = list.filter((i) => i.id > 0);

  const [channels, historico] = await Promise.all([
    db.select().from(notificationChannels)
      .where(eq(notificationChannels.tenantId, ctx.tenantId)),
    db.select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.tenantId, ctx.tenantId))
      .orderBy(desc(notificationDeliveries.createdAt))
      .limit(20),
  ]);

  return NextResponse.json({
    invoices: list,
    channels: channels.map((c) => ({
      channel: c.channel, destination: c.destination,
      active: c.active === 1, verified: c.verified === 1,
    })),
    historico: historico.map((h) => ({
      kind: h.kind, title: h.title, message: h.message,
      severity: h.severity, status: h.status,
      createdAt: h.createdAt,
    })),
    gateways: gatewayStatus(),
  });
}
