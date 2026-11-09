/**
 * Aplicacao idempotente de um evento de pagamento no banco real.
 * E a unica porta por onde um gateway muda o estado do contrato.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  paymentEvents, invoices, subscriptions, auditEvents,
} from '@/lib/db/schema';
import { rawHash, type CanonicalPaymentEvent } from './events';

export type ProcessResult = {
  duplicate: boolean;
  applied: boolean;
  tenantId: number | null;
  invoiceId: number | null;
  status: string;
};

function addDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 3600_000);
}

export async function processPaymentEvent(
  event: CanonicalPaymentEvent,
  raw: string,
): Promise<ProcessResult> {
  if (!event.id) throw new Error('Evento de pagamento sem id');

  const db = await getDb();

  // A8: chave de idempotencia = id do evento do gateway.
  const seen = await db.select({ id: paymentEvents.id })
    .from(paymentEvents).where(eq(paymentEvents.id, event.id)).limit(1);
  if (seen.length > 0) {
    return {
      duplicate: true, applied: false, tenantId: event.tenantId,
      invoiceId: null, status: 'duplicate',
    };
  }

  let tenantId = event.tenantId;
  let invoiceId: number | null = null;

  // Se o gateway nao mandou metadata, resolve pela fatura vinculada.
  if (event.invoiceGatewayId) {
    const [inv] = await db.select().from(invoices)
      .where(eq(invoices.gatewayId, event.invoiceGatewayId)).limit(1);
    if (inv) {
      invoiceId = inv.id;
      tenantId = tenantId ?? inv.tenantId;
    }
  }
  if (tenantId == null && event.amountBrl > 0) {
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.amountBrl, event.amountBrl), eq(invoices.status, 'open')))
      .limit(1);
    if (inv) {
      invoiceId = inv.id;
      tenantId = inv.tenantId;
    }
  }

  await db.insert(paymentEvents).values({
    id: event.id,
    tenantId,
    type: event.type,
    amountBrl: event.amountBrl,
    gateway: event.gateway,
    rawHash: rawHash(raw),
  });

  const succeeded = event.type === 'payment.succeeded';
  const failed = event.type === 'payment.failed';

  if (invoiceId != null) {
    await db.update(invoices).set(
      succeeded
        ? { status: 'paid', paidAt: new Date(), paymentLink: null }
        : { status: failed ? 'overdue' : 'processing' },
    ).where(eq(invoices.id, invoiceId));
  }

  let status = 'event_recorded';
  if (tenantId != null) {
    const [sub] = await db.select().from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId)).limit(1);
    if (sub) {
      if (succeeded) {
        await db.update(subscriptions).set({
          status: 'active',
          graceUntil: null,
          vigenciaAte: addDays(30),
          updatedAt: new Date(),
        }).where(eq(subscriptions.id, sub.id));
        status = 'subscription_active';
      } else if (failed) {
        await db.update(subscriptions).set({
          status: 'past_due',
          graceUntil: addDays(3),
          updatedAt: new Date(),
        }).where(eq(subscriptions.id, sub.id));
        status = 'subscription_past_due';
      }
    }
  }

  await db.insert(auditEvents).values({
    actor: `gateway:${event.gateway}`,
    tenantId,
    action: 'PAYMENT_EVENT',
    target: `event:${event.id}`,
    reason: `${event.gateway} · ${event.type} · R$ ${event.amountBrl.toFixed(2)}`,
    meta: { invoiceId, status },
  });

  return { duplicate: false, applied: true, tenantId, invoiceId, status };
}
