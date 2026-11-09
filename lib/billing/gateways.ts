/**
 * Clientes REST dos gateways. Sem SDK externo: `fetch` direto na API oficial,
 * o que mantem `npm ci` enxuto e o build reproduzivel.
 *
 *  - Stripe: checkout session (cartao) via STRIPE_SECRET_KEY.
 *  - Pix: Asaas por padrao (ASAAS_API_KEY / ASAAS_BASE_URL). Mercado Pago e
 *    Pagar.me entram trocando o adaptador de normalizacao, nao o dominio.
 *
 * Sem chave configurada o sistema NAO finge que cobrou: devolve modo `manual`
 * com aviso explicito. Nenhum QR Code falso e apresentado como pagavel.
 */
export type ChargeInput = {
  tenantId: number;
  invoiceId: number;
  amountBrl: number;
  description: string;
  dueDate?: string;
  successUrl?: string;
  cancelUrl?: string;
  customerId?: string | null; // customer criado/recuperado no Asaas para este tenant
};

export type ChargeResult = {
  gateway: 'stripe' | 'pix' | 'manual';
  gatewayId: string | null;
  paymentLink: string | null;
  pixCopiaCola: string | null;
  pixQrImage: string | null;
  demo: boolean;
  note: string;
};

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeKey(): string | null {
  return process.env.STRIPE_SECRET_KEY?.trim() || null;
}
function asaasKey(): string | null {
  return process.env.ASAAS_API_KEY?.trim() || null;
}
function asaasBase(): string {
  return (process.env.ASAAS_BASE_URL?.trim() || 'https://api.asaas.com').replace(/\/$/, '');
}
function publicUrl(): string {
  return (process.env.APP_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
}

async function stripeForm(fields: Record<string, string>): Promise<Record<string, unknown>> {
  const key = stripeKey();
  if (!key) throw new Error('STRIPE_SECRET_KEY ausente');
  const body = new URLSearchParams(fields);
  const r = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    throw new Error(`Stripe ${r.status}: ${String(json.error && typeof json.error === 'object' ? (json.error as Record<string, unknown>).message : json.error ?? 'erro')}`);
  }
  return json;
}

export async function createStripeCheckout(input: ChargeInput): Promise<ChargeResult> {
  if (!stripeKey()) {
    return manual(input, 'Configure STRIPE_SECRET_KEY para gerar um checkout real.');
  }
  const centavos = Math.max(1, Math.round(input.amountBrl * 100));
  const session = await stripeForm({
    mode: 'payment',
    client_reference_id: String(input.tenantId),
    'metadata[tenant_id]': String(input.tenantId),
    'metadata[invoice_id]': String(input.invoiceId),
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'brl',
    'line_items[0][price_data][unit_amount]': String(centavos),
    'line_items[0][price_data][product_data][name]': input.description,
    success_url: input.successUrl ?? `${publicUrl()}/portal?pagamento=ok`,
    cancel_url: input.cancelUrl ?? `${publicUrl()}/portal?pagamento=cancelado`,
  });
  return {
    gateway: 'stripe',
    gatewayId: String(session.id ?? ''),
    paymentLink: typeof session.url === 'string' ? session.url : null,
    pixCopiaCola: null,
    pixQrImage: null,
    demo: false,
    note: 'Checkout Stripe criado. O webhook confirmara o pagamento.',
  };
}

export async function asaas(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const key = asaasKey();
  if (!key) throw new Error('ASAAS_API_KEY ausente');
  const r = await fetch(`${asaasBase()}${path}`, {
    ...init,
    headers: {
      access_token: key,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    throw new Error(`Asaas ${r.status}: ${JSON.stringify(json.errors ?? json.message ?? json)}`);
  }
  return json;
}

export async function createPixCharge(input: ChargeInput): Promise<ChargeResult> {
  if (!asaasKey()) {
    return manual(input, 'Configure ASAAS_API_KEY para gerar o QR Code Pix real.');
  }
  if (!input.customerId || !/^cus_[A-Za-z0-9]+$/.test(input.customerId)) {
    throw new Error('Cadastro do pagador Asaas é obrigatório antes da cobrança Pix');
  }
  const payment = await asaas('/v3/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: input.customerId,
      billingType: 'PIX',
      value: Number(input.amountBrl.toFixed(2)),
      dueDate: input.dueDate ?? new Date().toISOString().slice(0, 10),
      externalReference: `vigiaplus-invoice-${input.invoiceId}-tenant-${input.tenantId}`,
      description: `VigiaPlus fatura #${input.invoiceId} — ${input.description}`,
    }),
  });
  const id = String(payment.id ?? '');
  let copiaCola: string | null = null;
  let qrImage: string | null = null;
  try {
    const qr = await asaas(`/v3/payments/${id}/pixQrCode`);
    copiaCola = typeof qr.payload === 'string' ? qr.payload : null;
    qrImage = typeof qr.encodedImage === 'string' ? qr.encodedImage : null;
  } catch {
    // Alguns gateways so expoe o QR apos confirmacao; nao e fatal.
  }
  return {
    gateway: 'pix',
    gatewayId: id,
    paymentLink: typeof payment.invoiceUrl === 'string' ? payment.invoiceUrl : null,
    pixCopiaCola: copiaCola,
    pixQrImage: qrImage,
    demo: false,
    note: 'Cobranca Pix registrada. O webhook confirmara o pagamento.',
  };
}

function manual(input: ChargeInput, reason: string): ChargeResult {
  return {
    gateway: 'manual',
    gatewayId: `manual-${input.tenantId}-${input.invoiceId}`,
    paymentLink: null,
    pixCopiaCola: null,
    pixQrImage: null,
    demo: true,
    note: `${reason} Enquanto isso, a fatura fica registrada como "em aberto" para conferencia.`,
  };
}

export function gatewayStatus() {
  return {
    stripe: { configured: Boolean(stripeKey()), webhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET) },
    pix: { configured: Boolean(asaasKey()), webhook: Boolean(process.env.ASAAS_WEBHOOK_AUTH_TOKEN) },
    appUrl: publicUrl(),
  };
}
