/**
 * Conciliação de eventos de pagamento. NUNCA correlacionar faturas por valor.
 * Chave segura: (gateway, id do evento) para replay; (gateway, id da cobrança)
 * para autorizar a alteração de fatura e assinatura, com verificação de valor.
 * Eventos pendentes podem ser reprocessados quando o gateway repetir entrega.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { paymentEvents, invoices, subscriptions, auditEvents } from '@/lib/db/schema';
import { rawHash, type CanonicalPaymentEvent } from './events';

export type ProcessResult = {
  duplicate: boolean;
  applied: boolean;
  tenantId: number | null;
  invoiceId: number | null;
  status: string;
};

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export async function processPaymentEvent(
  event: CanonicalPaymentEvent,
  raw: string,
): Promise<ProcessResult> {
  if (!event.id || !['stripe', 'pix'].includes(event.gateway)) {
    throw new Error('Evento sem identificador de gateway válido');
  }
  // Eventos sem alteração financeira não autorizam assinatura.
  if (event.type !== 'payment.succeeded' && event.type !== 'payment.failed') {
    return { duplicate: false, applied: false, tenantId: null, invoiceId: null, status: 'ignored' };
  }
  if (!event.invoiceGatewayId) {
    return { duplicate: false, applied: false, tenantId: null, invoiceId: null, status: 'unmatched' };
  }

  const db = await getDb();
  const [inv] = await db.select().from(invoices).where(and(
    eq(invoices.gateway, event.gateway), eq(invoices.gatewayId, event.invoiceGatewayId),
  )).limit(1);
  if (!inv || (event.tenantId != null && inv.tenantId !== event.tenantId)) {
    return { duplicate: false, applied: false, tenantId: null, invoiceId: null, status: 'unmatched' };
  }
  // Não confiar em IDs/tenant ou valor enviados pelo body de um gateway sem
  // confirmar a cobrança persistida anteriormente no banco.
  if (event.type === 'payment.succeeded' &&
      Math.round(inv.amountBrl * 100) !== Math.round(event.amountBrl * 100)) {
    return { duplicate: false, applied: false, tenantId: inv.tenantId, invoiceId: inv.id, status: 'amount_mismatch' };
  }

  const key = `${event.gateway}:${event.id}`;
  const [known] = await db.select({ processedAt: paymentEvents.processedAt })
    .from(paymentEvents).where(eq(paymentEvents.id, key)).limit(1);
  if (known?.processedAt) {
    return { duplicate: true, applied: false, tenantId: inv.tenantId, invoiceId: inv.id, status: 'duplicate' };
  }
  await db.insert(paymentEvents).values({
    id: key, tenantId: inv.tenantId, type: event.type,
    amountBrl: event.amountBrl, gateway: event.gateway, rawHash: rawHash(raw),
  }).onConflictDoNothing();

  let status = 'event_recorded';
  if (event.type === 'payment.succeeded') {
    const paidAt = inv.paidAt ?? new Date();
    await db.update(invoices).set({
      status: 'paid', paidAt, paymentLink: null,
    }).where(eq(invoices.id, inv.id));
    const [sub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.tenantId, inv.tenantId)).limit(1);
    if (sub) {
      await db.update(subscriptions).set({
        status: 'active', graceUntil: null,
        vigenciaAte: addDays(paidAt, 30), updatedAt: new Date(),
      }).where(eq(subscriptions.id, sub.id));
      status = 'subscription_active';
    } else {
      status = 'invoice_paid_without_subscription';
    }
  } else if (inv.status !== 'paid') {
    await db.update(invoices).set({ status: 'overdue' }).where(eq(invoices.id, inv.id));
    const [sub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.tenantId, inv.tenantId)).limit(1);
    if (sub) {
      await db.update(subscriptions).set({
        status: 'past_due', graceUntil: addDays(new Date(), 3), updatedAt: new Date(),
      }).where(eq(subscriptions.id, sub.id));
      status = 'subscription_past_due';
    }
  } else {
    status = 'ignored_already_paid';
  }

  await db.insert(auditEvents).values({
    actor: `gateway:${event.gateway}`, tenantId: inv.tenantId,
    action: 'PAYMENT_EVENT', target: `event:${key}`,
    reason: `${event.gateway} · ${event.type} · R$ ${event.amountBrl.toFixed(2)}`,
    meta: { invoiceId: inv.id, status },
  });
  // Marcar somente após as escritas. Falha intermediária permite que reentrega
  // reprocese sem prorrogação em cascata da vigência (paidAt é estável).
  await db.update(paymentEvents).set({ processedAt: new Date() }).where(eq(paymentEvents.id, key));

  return { duplicate: false, applied: true, tenantId: inv.tenantId, invoiceId: inv.id, status };
}
