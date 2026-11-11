/**
 * Fila de entregas (H2). Idempotente por (tenant_id, dedupe_key):
 * o mesmo fato/regra/canal/destino nunca dispara duas vezes no dia.
 * O banco arbitra concorrência com UNIQUE + ON CONFLICT DO NOTHING.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notificationDeliveries } from '@/lib/db/schema';
import { send } from './transport';
import { sameDestination } from './dedupe';

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
  /** Chave histórica opcional, usada apenas para não reenviar ao destinatário legado. */
  legacyDedupeKey?: string;
};

export async function enqueue(input: EnqueueInput): Promise<boolean> {
  const db = await getDb();
  // Registros anteriores à ALT-01 usam regra/fato/dia sem canal/destino.
  // Preservar o destinatário que JÁ recebeu sem reenviar automaticamente;
  // os outros destinatários poderão receber normalmente sua primeira entrega.
  // Nenhum dado antigo é excluído ou reescrito nesta migração conservadora.
  if (input.legacyDedupeKey) {
    const legacy = await db.select({
      channel: notificationDeliveries.channel,
      destination: notificationDeliveries.destination,
    }).from(notificationDeliveries).where(and(
      eq(notificationDeliveries.tenantId, input.tenantId),
      eq(notificationDeliveries.dedupeKey, input.legacyDedupeKey),
    )).limit(1);
    if (legacy.some(row => sameDestination(
      row.channel, row.destination, input.channel, input.destination,
    ))) return false;
  }

  // Antes havia SELECT + INSERT, sujeito a corrida entre dois workers.
  // Este único INSERT usa o índice UNIQUE já existente no schema:
  // notification_deliveries_dedupe (tenant_id, dedupe_key).
  const inserted = await db.insert(notificationDeliveries).values({
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
  }).onConflictDoNothing({
    target: [notificationDeliveries.tenantId, notificationDeliveries.dedupeKey],
  }).returning({ id: notificationDeliveries.id });
  return inserted.length === 1;
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
