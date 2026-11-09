import { NextResponse } from 'next/server';
import { verifyStripeSignature, StripeAdapter } from '@/lib/billing/events';
import { processPaymentEvent } from '@/lib/billing/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Webhook Stripe. Fail-closed: sem secret configurado, nao processa nada. */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'webhook_nao_configurado' }, { status: 503 });
  }

  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'assinatura_invalida' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'payload_invalido' }, { status: 400 });
  }

  const event = StripeAdapter.normalize(body);
  if (!event.id) {
    return NextResponse.json({ error: 'evento_sem_id' }, { status: 400 });
  }

  const result = await processPaymentEvent(event, raw);
  const retry = ['unmatched', 'amount_mismatch', 'ambiguous_charge', 'event_conflict'].includes(result.status);
  return NextResponse.json({ received: !retry, ...result }, { status: retry ? 503 : 200 });
}

export async function GET() {
  return NextResponse.json({
    gateway: 'stripe',
    configurado: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    evento: 'POST / checkouts e invoices',
  });
}
