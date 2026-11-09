import { NextResponse } from 'next/server';
import { verifyAsaasWebhookToken, PixAdapter } from '@/lib/billing/events';
import { processPaymentEvent } from '@/lib/billing/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Asaas: autenticação pela credencial dedicada do webhook (asaas-access-token). */
export async function POST(req: Request) {
  const secret = process.env.ASAAS_WEBHOOK_AUTH_TOKEN?.trim();
  if (!secret || secret.length < 32) {
    return NextResponse.json({ error: 'webhook_nao_configurado' }, { status: 503 });
  }
  if (!verifyAsaasWebhookToken(req.headers.get('asaas-access-token'), secret)) {
    return NextResponse.json({ error: 'assinatura_invalida' }, { status: 401 });
  }
  const raw = await req.text();

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
  const retry = ['unmatched', 'amount_mismatch', 'ambiguous_charge', 'event_conflict'].includes(result.status);
  return NextResponse.json({ received: !retry, ...result }, { status: retry ? 503 : 200 });
}

export async function GET() {
  return NextResponse.json({
    gateway: 'pix',
    configurado: Boolean(process.env.ASAAS_WEBHOOK_AUTH_TOKEN && process.env.ASAAS_WEBHOOK_AUTH_TOKEN.length >= 32),
    evento: 'POST / confirmacoes de pagamento',
  });
}
