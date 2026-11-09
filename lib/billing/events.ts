/**
 * Eventos de pagamento — porte de foundation/src/payments.js para Drizzle.
 * Contrato unico: qualquer gateway vira { id, type, tenantId, amountBrl }.
 * A8 (adversarial): replay do mesmo evento NAO aplica duas vezes.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type CanonicalPaymentEvent = {
  id: string;
  type: string;
  tenantId: number | null;
  amountBrl: number;
  gateway: string;
  invoiceGatewayId: string | null;
};

export type GatewayAdapter = {
  name: string;
  normalize: (raw: Record<string, unknown>) => CanonicalPaymentEvent;
};

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function tenantOf(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function signWebhook(raw: string, secret: string): string {
  return createHmac('sha256', secret).update(raw).digest('hex');
}

/** Comparacao em tempo constante. Nunca usar === para assinatura. */
export function verifyWebhook(raw: string, signature: string | null, secret: string): boolean {
  if (!raw || !signature || !secret) return false;
  const a = Buffer.from(String(signature));
  const b = Buffer.from(signWebhook(raw, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Assinatura Stripe: header `t=<epoch>,v1=<hex>` sobre `${t}.${raw}`.
 * Sem SDK externo, mas compativel com o formato oficial.
 * `tolerance` impede replay de payload antigo (default 5 min).
 */
export function verifyStripeSignature(
  raw: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!raw || !header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return i < 0 ? ['', ''] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
  const a = Buffer.from(v1);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const StripeAdapter: GatewayAdapter = {
  name: 'stripe',
  normalize(raw) {
    const data = obj(raw.data).object as Record<string, unknown>;
    const meta = obj(data.metadata);
    return {
      id: String(raw.id ?? ''),
      type: raw.type === 'invoice.payment_succeeded' || raw.type === 'checkout.session.completed'
        ? 'payment.succeeded'
        : raw.type === 'invoice.payment_failed'
          ? 'payment.failed'
          : String(raw.type ?? ''),
      // O tenant vem do metadata que NOS colocamos no checkout, nunca do corpo livre.
      tenantId: tenantOf(meta.tenant_id ?? meta.tenantId),
      amountBrl: num(data.amount_paid ?? data.amount_total ?? data.amount) / 100,
      gateway: 'stripe',
      invoiceGatewayId: data.id != null ? String(data.id) : null,
    };
  },
};

/** Asaas / Mercado Pago / Pagar.me entram aqui sem mudar o dominio. */
export const PixAdapter: GatewayAdapter = {
  name: 'pix',
  normalize(raw) {
    const payment = obj(raw.payment ?? raw.data);
    const eventName = String(raw.event ?? raw.type ?? '');
    return {
      id: String(raw.id ?? raw.event ?? payment.id ?? ''),
      type: /CONFIRMED|RECEIVED|PAID|payment.succeeded/i.test(eventName)
        ? 'payment.succeeded'
        : /OVERDUE|REFUSED|FAILED/i.test(eventName)
          ? 'payment.failed'
          : eventName,
      tenantId: tenantOf(payment.externalReference ?? raw.externalReference),
      amountBrl: num(payment.value ?? payment.amount ?? raw.amount_brl),
      gateway: 'pix',
      invoiceGatewayId: payment.id != null ? String(payment.id) : null,
    };
  },
};

export const ADAPTERS: Record<string, GatewayAdapter> = {
  stripe: StripeAdapter,
  pix: PixAdapter,
};

export function rawHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
