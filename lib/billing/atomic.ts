/** Evento, invoice, assinatura e auditoria: UMA instrução SQL atômica. */
import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import type { CanonicalPaymentEvent } from './events';

export type AtomicOutcome = { matched: boolean; claimed: boolean; invoiceChanged: boolean; subscriptionChanged: boolean; audited: boolean };

function firstRow(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) return result[0] as Record<string, unknown> ?? {};
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return (rows[0] as Record<string, unknown>) ?? {};
  }
  throw new Error('Retorno inesperado da conciliação atômica');
}

/** CTEs que dependem do RETURNING da chave única do evento: replay não reexecuta. */
export async function applyPaymentAtomically(db: DB, event: CanonicalPaymentEvent, digest: string): Promise<AtomicOutcome> {
  const key = event.gateway + ':' + event.id;
  const paid = event.type === 'payment.succeeded';
  const cents = Math.round(event.amountBrl * 100);
  const rows = await db.execute(sql`
    WITH charge AS (
      SELECT i.id, i.tenant_id FROM invoices i
      WHERE i.gateway = ${event.gateway} AND i.gateway_id = ${event.invoiceGatewayId}
        AND (${event.tenantId}::integer IS NULL OR i.tenant_id = ${event.tenantId}::integer)
        AND (NOT ${paid}::boolean OR ROUND(i.amount_brl::numeric * 100)::integer = ${cents})
        AND (SELECT COUNT(*) FROM invoices other
          WHERE other.gateway = ${event.gateway} AND other.gateway_id = ${event.invoiceGatewayId}) = 1
      LIMIT 1
    ),
    claim AS (
      INSERT INTO payment_events AS pe (id, tenant_id, type, amount_brl, gateway, raw_hash, processed_at)
      SELECT ${key}, charge.tenant_id, ${event.type}, ${event.amountBrl},
        ${event.gateway}, ${digest}, NOW() FROM charge WHERE TRUE
      ON CONFLICT (id) DO UPDATE SET processed_at = NOW()
      WHERE pe.processed_at IS NULL AND pe.raw_hash = EXCLUDED.raw_hash
      RETURNING id
    ),
    changed_invoice AS (
      UPDATE invoices i SET
        status = CASE WHEN ${paid}::boolean THEN 'paid' ELSE 'overdue' END,
        paid_at = CASE WHEN ${paid}::boolean THEN COALESCE(i.paid_at, NOW()) ELSE i.paid_at END,
        payment_link = CASE WHEN ${paid}::boolean THEN NULL ELSE i.payment_link END
      FROM charge, claim
      WHERE i.id = charge.id AND i.status <> 'paid'
      RETURNING i.id, i.tenant_id, i.paid_at
    ),
    changed_subscription AS (
      UPDATE subscriptions s SET
        status = CASE WHEN ${paid}::boolean THEN 'active' ELSE 'past_due' END,
        grace_until = CASE WHEN ${paid}::boolean THEN NULL ELSE NOW() + INTERVAL '3 days' END,
        vigencia_ate = CASE WHEN ${paid}::boolean
          THEN (SELECT paid_at + INTERVAL '30 days' FROM changed_invoice LIMIT 1)
          ELSE s.vigencia_ate END,
        updated_at = NOW()
      FROM changed_invoice ci
      WHERE s.tenant_id = ci.tenant_id
        AND s.id = (
          SELECT selected.id FROM subscriptions selected
          WHERE selected.tenant_id = ci.tenant_id
            AND (selected.gateway = ${event.gateway} OR selected.gateway = 'manual')
          ORDER BY selected.id DESC LIMIT 1
        )
      RETURNING s.id
    ),
    audit_inserted AS (
      INSERT INTO audit_events (actor, tenant_id, action, target, reason, meta)
      SELECT ${'gateway:' + event.gateway}, charge.tenant_id, 'PAYMENT_EVENT',
        ${'event:' + key}, ${event.gateway + ' · ' + event.type},
        jsonb_build_object('invoiceId', charge.id, 'applied',
          EXISTS (SELECT 1 FROM changed_invoice))
      FROM charge, claim
      RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM charge) AS matched,
      EXISTS (SELECT 1 FROM claim) AS claimed,
      EXISTS (SELECT 1 FROM changed_invoice) AS invoice_changed,
      EXISTS (SELECT 1 FROM changed_subscription) AS subscription_changed,
      EXISTS (SELECT 1 FROM audit_inserted) AS audited
  `);
  const row = firstRow(rows);
  return { matched: row.matched === true, claimed: row.claimed === true,
    invoiceChanged: row.invoice_changed === true,
    subscriptionChanged: row.subscription_changed === true, audited: row.audited === true };
}
