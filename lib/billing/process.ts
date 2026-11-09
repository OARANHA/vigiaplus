/**
 * Conciliação financeira fail-closed: evento + fatura + assinatura + auditoria
 * passam juntos em uma única instrução SQL, inclusive no Neon HTTP.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { invoices, paymentEvents } from '@/lib/db/schema';
import { rawHash, type CanonicalPaymentEvent } from './events';
import { applyPaymentAtomically } from './atomic';

export type ProcessResult = {
  duplicate: boolean;
  applied: boolean;
  tenantId: number | null;
  invoiceId: number | null;
  status: string;
};

export async function processPaymentEvent(event: CanonicalPaymentEvent, raw: string): Promise<ProcessResult> {
  if (!event.id || event.id.length > 255 || !['stripe', 'pix'].includes(event.gateway)) {
    throw new Error('Evento sem identificador de gateway válido');
  }
  if (event.type !== 'payment.succeeded' && event.type !== 'payment.failed') {
    return { duplicate: false, applied: false, tenantId: null, invoiceId: null, status: 'ignored' };
  }
  if (!event.invoiceGatewayId || event.invoiceGatewayId.length > 255) {
    return { duplicate: false, applied: false, tenantId: null, invoiceId: null, status: 'unmatched' };
  }
  const db = await getDb();
  const target = await db.select().from(invoices).where(and(
    eq(invoices.gateway, event.gateway), eq(invoices.gatewayId, event.invoiceGatewayId),
  )).limit(2);
  if (target.length > 1) {
    return { duplicate: false, applied: false, tenantId: null, invoiceId: null, status: 'ambiguous_charge' };
  }
  const inv = target[0];
  if (!inv || (event.tenantId != null && inv.tenantId !== event.tenantId)) {
    return { duplicate: false, applied: false, tenantId: null, invoiceId: null, status: 'unmatched' };
  }
  if (event.type === 'payment.succeeded' &&
      Math.round(inv.amountBrl * 100) !== Math.round(event.amountBrl * 100)) {
    return { duplicate: false, applied: false, tenantId: inv.tenantId, invoiceId: inv.id, status: 'amount_mismatch' };
  }

  const digest = rawHash(raw);
  const key = event.gateway + ':' + event.id;
  const [known] = await db.select().from(paymentEvents).where(eq(paymentEvents.id, key)).limit(1);
  if (known?.rawHash && known.rawHash !== digest) {
    return { duplicate: false, applied: false, tenantId: inv.tenantId, invoiceId: inv.id, status: 'event_conflict' };
  }

  const outcome = await applyPaymentAtomically(db, event, digest);
  if (!outcome.matched) {
    return { duplicate: false, applied: false, tenantId: inv.tenantId, invoiceId: inv.id, status: 'unmatched' };
  }
  if (!outcome.claimed) {
    const [existing] = await db.select().from(paymentEvents).where(eq(paymentEvents.id, key)).limit(1);
    const conflict = Boolean(existing?.rawHash && existing.rawHash !== digest);
    return { duplicate: !conflict, applied: false, tenantId: inv.tenantId, invoiceId: inv.id,
      status: conflict ? 'event_conflict' : 'duplicate' };
  }
  if (!outcome.audited) throw new Error('Conciliação sem auditoria; operação inválida');
  const status = !outcome.invoiceChanged ? 'ignored_already_paid'
    : outcome.subscriptionChanged
      ? (event.type === 'payment.succeeded' ? 'subscription_active' : 'subscription_past_due')
      : (event.type === 'payment.succeeded' ? 'invoice_paid_without_subscription' : 'invoice_overdue_without_subscription');
  return { duplicate: false, applied: outcome.invoiceChanged,
    tenantId: inv.tenantId, invoiceId: inv.id, status };
}
