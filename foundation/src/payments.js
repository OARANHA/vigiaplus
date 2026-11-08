// Gateway abstrato + adaptadores + webhook idempotente (A8).
// O estado da assinatura dirige os entitlements — nunca o frontend.
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { err } from './errors.js';
import { appendAudit } from './audit.js';

export function signWebhook(rawPayload, secret) {
  return createHmac('sha256', secret).update(rawPayload).digest('hex');
}

export function verifyWebhook(rawPayload, signature, secret) {
  if (!rawPayload || !signature || !secret) return false;
  const expected = signWebhook(rawPayload, secret);
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --------------------------------------------------------------- adaptadores
// Contrato único: normalize(raw) -> evento canônico { id, type, tenant_id, amount_brl }.
export const StripeAdapter = {
  name: 'stripe',
  normalize(raw) {
    return {
      id: raw.id,
      type: raw.type === 'invoice.payment_succeeded' ? 'payment.succeeded' : raw.type,
      tenant_id: raw.data?.object?.metadata?.tenant_id ?? null,
      amount_brl: (raw.data?.object?.amount_paid ?? 0) / 100,
    };
  },
};

export const PixAdapter = {
  name: 'pix',
  // Asaas / Mercado Pago / Pagar.me entram aqui sem mudar o domínio.
  normalize(raw) {
    return {
      id: raw.event ?? raw.id,
      type: raw.event === 'PAYMENT_CONFIRMED' ? 'payment.succeeded' : (raw.event ?? raw.type),
      tenant_id: raw.payment?.externalReference ?? null,
      amount_brl: Number(raw.payment?.value ?? 0),
    };
  },
};

export function createGateway(adapter) {
  if (!adapter?.normalize) throw new Error('Adaptador inválido');
  return {
    name: adapter.name,
    normalize: (raw) => adapter.normalize(raw),
  };
}

// ------------------------------------------------------------------ webhook
/** @returns {{duplicate:boolean, applied:boolean, event:object}} */
export function processPaymentEvent(store, event, { secret, rawPayload, signature, adapter } = {}) {
  if (!event?.id) throw err.badRequest('Evento de pagamento sem id');

  const raw = rawPayload ?? JSON.stringify({ id: event.id, type: event.type, tenant_id: event.tenant_id });
  if (secret && !verifyWebhook(raw, signature, secret)) {
    throw err.signature();
  }

  // A8: chave de idempotência = id do evento. Replay não aplica duas vezes.
  const existing = store.findRaw('payment_events', (e) => e.id === event.id);
  if (existing) {
    return { duplicate: true, applied: false, event: existing };
  }

  const row = {
    id: event.id,
    tenant_id: event.tenant_id ?? null,
    type: event.type,
    amount_brl: Number(event.amount_brl) || 0,
    gateway: adapter?.name ?? 'unknown',
    raw_hash: createHash('sha256').update(raw).digest('hex'),
    received_at: new Date().toISOString(),
  };
  store.insertRaw('payment_events', row);

  const subscription = store.findRaw('subscriptions', (s) => String(s.tenant_id) === String(event.tenant_id));
  if (subscription) {
    if (event.type === 'payment.succeeded' || event.type === 'PAYMENT_CONFIRMED') {
      subscription.status = 'active';
    } else if (event.type === 'payment.failed' || event.type === 'PAYMENT_OVERDUE') {
      subscription.status = 'past_due';
    }
  }

  const systemCtx = {
    userId: null,
    role: 'system',
    tenantId: event.tenant_id ?? null,
    system: true,
    requestId: null,
  };
  appendAudit(store, systemCtx, {
    action: 'PAYMENT_EVENT',
    target: `event:${event.id}`,
    reason: `${row.gateway} · ${row.type}`,
  });
  return { duplicate: false, applied: true, event: row };
}
