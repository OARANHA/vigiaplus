/**
 * Fila de entregas (H2). Idempotente por (tenant_id, dedupe_key):
 * a mesma regra nunca dispara duas vezes para o mesmo fato.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notificationDeliveries } from '@/lib/db/schema';
import { send } from './transport';

export type EnqueueInput = {
  tenantId: number;
  ruleId?: number | null;
  channel: string;
  destination: string;
  kind: string;
  severity?: string;
  title: string;
  message: string;
  dedupeKey: string;
};

export async function enqueue(input: EnqueueInput): Promise<boolean> {
  const db = await getDb();
  const existing = await db.select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(and(
      eq(notificationDeliveries.tenantId, input.tenantId),
      eq(notificationDeliveries.dedupeKey, input.dedupeKey),
    )).limit(1);
  if (existing.length > 0) return false;

  await db.insert(notificationDeliveries).values({
    tenantId: input.tenantId,
    ruleId: input.ruleId ?? null,
    channel: input.channel,
    destination: input.destination,
    kind: input.kind,
    severity: input.severity ?? 'info',
    title: input.title,
    message: input.message,
    status: 'queued',
    dedupeKey: input.dedupeKey,
  });
  return true;
}

/** Envia o que esta na fila. Pode rodar em qualquer worker ou no cron. */
export async function dispatchPending(limit = 100): Promise<{ sent: number; failed: number }> {
  const db = await getDb();
  const pending = await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.status, 'queued')).limit(limit);

  let sent = 0;
  let failed = 0;
  for (const item of pending) {
    const result = await send({
      channel: item.channel,
      destination: item.destination,
      title: item.title,
      message: item.message,
    });
    await db.update(notificationDeliveries).set({
      status: result.ok ? 'sent' : 'failed',
      sentAt: result.ok ? new Date() : null,
      error: result.ok ? null : result.detail.slice(0, 500),
    }).where(eq(notificationDeliveries.id, item.id));
    if (result.ok) sent++; else failed++;
  }
  return { sent, failed };
}
