import { NextResponse } from 'next/server';
import { verifyWebhook, PixAdapter } from '@/lib/billing/events';
import { processPaymentEvent } from '@/lib/billing/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook Pix (Asaas / Mercado Pago / Pagar.me).
 * Assinatura HMAC-SHA256 sobre o corpo cru, em tempo constante.
 * O tenant vem de `externalReference`, que nos mesmos gravamos no checkout.
 */
export async function POST(req: Request) {
  const secret = process.env.PIX_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'webhook_nao_configurado' }, { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get('x-webhook-signature')
    ?? req.headers.get('x-asaas-signature')
    ?? req.headers.get('x-hub-signature');
  if (!verifyWebhook(raw, signature, secret)) {
    return NextResponse.json({ error: 'assinatura_invalida' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const event = PixAdapter.normalize(body);
  if (!event.id) {
    return NextResponse.json({ error: 'evento_sem_id' }, { status: 400 });
  }

  const result = await processPaymentEvent(event, raw);
  return NextResponse.json({ received: true, ...result });
}

export async function GET() {
  return NextResponse.json({
    gateway: 'pix',
    configurado: Boolean(process.env.PIX_WEBHOOK_SECRET),
    evento: 'POST / confirmacoes de pagamento',
  });
}
