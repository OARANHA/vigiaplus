import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { invoices } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireAction } from '@/lib/tenant/rbac';
import { createStripeCheckout, createPixCharge } from '@/lib/billing/gateways';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cria uma cobrança para uma fatura do proprio tenant.
 * O cliente nunca escolhe o tenant: ele vem da sessao.
 * Sem chave do gateway, devolve modo `manual` com aviso honesto.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const requestedTenantId = Number(url.searchParams.get('tenant_id')) || null;
  const ctx = await resolveTenantContext({ surface: 'app', requestedTenantId });
  requireAction(ctx, 'pay_invoice');

  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'Sem tenant ativo' }, { status: 400 });
  }

  let body: { invoiceId?: unknown; method?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 });
  }

  const invoiceId = Number(body.invoiceId);
  const method = body.method === 'pix' ? 'pix' : body.method === 'card' ? 'card' : null;
  if (!Number.isInteger(invoiceId) || !method) {
    return NextResponse.json({ error: 'Informe invoiceId e method (pix|card)' }, { status: 400 });
  }

  const db = await getDb();
  const [inv] = await db.select().from(invoices)
    .where(eq(invoices.id, invoiceId)).limit(1);
  // Checagem explicita de posse: a fatura tem de ser do tenant da sessao.
  if (!inv || inv.tenantId !== ctx.tenantId) {
    return NextResponse.json({ error: 'Fatura nao encontrada' }, { status: 404 });
  }
  if (inv.status === 'paid') {
    return NextResponse.json({ error: 'Fatura ja paga' }, { status: 409 });
  }

  const input = {
    tenantId: ctx.tenantId,
    invoiceId,
    amountBrl: inv.amountBrl,
    description: inv.description ?? `Plano VigiaPlus — fatura #${invoiceId}`,
    dueDate: inv.dueAt ?? undefined,
  };

  const charge = method === 'pix'
    ? await createPixCharge(input)
    : await createStripeCheckout(input);

  await db.update(invoices).set({
    gateway: charge.gateway,
    gatewayId: charge.gatewayId,
    paymentLink: charge.paymentLink,
    pixCopiaCola: charge.pixCopiaCola,
    pixQrcode: charge.pixCopiaCola,
    status: charge.demo ? inv.status : 'processing',
  }).where(eq(invoices.id, invoiceId));

  return NextResponse.json({
    invoiceId,
    method,
    amount: inv.amountBrl,
    gateway: charge.gateway,
    paymentLink: charge.paymentLink,
    pixCopiaCola: charge.pixCopiaCola,
    demo: charge.demo,
    note: charge.note,
  });
}
