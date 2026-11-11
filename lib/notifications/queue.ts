/**
 * Fila de entregas (H2). Idempotente por (tenant_id, dedupe_key):
 * o mesmo fato/regra/canal/destino nunca dispara duas vezes no dia.
 * O banco arbitra concorrência com UNIQUE + ON CONFLICT DO NOTHING.
 */
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DB } from '@/lib/db';
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

/**
 * ALT-02: um worker reivindica registros numa única instrução SQL. O lock
 * SKIP LOCKED dura só durante a reserva; o lease persiste entre requisições.
 * Não segurar transação aberta durante chamadas externas (Resend, Telegram).
 *
 * LIMITAÇÃO: entregas externas são pelo menos uma vez após crashes entre o
 * aceite do provedor e a gravação local. Confirmação e idempotência por provedor
 * ainda são escopo de ALT-06; não prometer exactly-once externo.
 */
export const DELIVERY_MAX_ATTEMPTS = 5;
export const DELIVERY_LEASE_SECONDS = 60;

export function retryDelaySeconds(attemptCount: number): number {
  if (!Number.isFinite(attemptCount) || attemptCount < 1) return 60;
  return Math.min(3600, 60 * 2 ** Math.min(6, Math.floor(attemptCount) - 1));
}

export type ClaimedDelivery = {
  id: number;
  tenant_id: number;
  channel: string;
  destination: string;
  title: string;
  message: string;
  attempt_count: number;
};

/** Retira da fila registros sem tentativas restantes, sem invocar o provedor. */
export async function sweepExhaustedDeliveries(db: DB): Promise<number> {
  const result = await db.execute(sql`
    UPDATE notification_deliveries
       SET status='dead_letter', lease_owner=NULL, lease_expires_at=NULL,
           next_attempt_at=NULL,
           error=COALESCE(error, 'Limite de tentativas esgotado')
     WHERE attempt_count >= ${DELIVERY_MAX_ATTEMPTS}
       AND (
         status IN ('queued','retry')
         OR (status='processing' AND (lease_expires_at IS NULL OR lease_expires_at<=now()))
       )
     RETURNING id
  `);
  return result.rows.length;
}

/**
 * Reservar mensagens prontas ou com lease expirado. SKIP LOCKED evita que
 * dois workers concorrentes recebam a mesma entrega.
 */
export async function claimPendingDeliveries(
  db: DB, limit: number, workerId: string,
): Promise<ClaimedDelivery[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new Error('Limite do lote inválido (1 a 500)');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(workerId))
    throw new Error('Identificador do worker inválido');
  const result = await db.execute(sql`
    WITH candidates AS (
      SELECT id FROM notification_deliveries
       WHERE attempt_count < ${DELIVERY_MAX_ATTEMPTS}
         AND (
           (status IN ('queued','retry')
             AND (next_attempt_at IS NULL OR next_attempt_at<=now()))
           OR (status='processing' AND lease_expires_at<=now())
         )
       ORDER BY created_at ASC, id ASC
       LIMIT ${limit}
       FOR UPDATE SKIP LOCKED
    )
    UPDATE notification_deliveries AS d
       SET status='processing',
           lease_owner=${workerId},
           lease_expires_at=now() + ${DELIVERY_LEASE_SECONDS} * interval '1 second',
           attempt_count=d.attempt_count+1,
           last_attempt_at=now(),
           next_attempt_at=NULL,
           error=NULL
      FROM candidates
     WHERE d.id=candidates.id
     RETURNING d.id,d.tenant_id,d.channel,d.destination,d.title,d.message,d.attempt_count
  `);
  return result.rows.map((row) => ({
    id: Number(row.id), tenant_id: Number(row.tenant_id),
    channel: String(row.channel), destination: String(row.destination),
    title: String(row.title), message: String(row.message),
    attempt_count: Number(row.attempt_count),
  }));
}

export type DeliveryCompletion = 'accepted' | 'retry' | 'dead_letter' | 'lost_lease';

/**
 * Um processo atrasado não tem permissão de finalizar a entrega cujo lease
 * já foi assumido por outro worker. status=sent significa HTTP aceito, não
 * confirmação final de entrega na caixa de entrada (ALT-06 pendente).
 */
export async function finishClaimedDelivery(
  db: DB,
  delivery: Pick<ClaimedDelivery, 'id' | 'attempt_count'>,
  workerId: string,
  result: { ok: boolean; detail: string },
): Promise<DeliveryCompletion> {
  const exhausted = !result.ok && delivery.attempt_count >= DELIVERY_MAX_ATTEMPTS;
  const status = result.ok ? 'sent' : exhausted ? 'dead_letter' : 'retry';
  const delay = result.ok ? 0 : retryDelaySeconds(delivery.attempt_count);
  // O erro de transporte fica limitado e sanitizado: não salvar exceções brutas
  // que possam conter URLs com tokens ou headers de autenticação.
  const error = result.ok ? null : (
    /^HTTP \d{3}$/.test(result.detail) ? result.detail : 'Falha de transporte'
  );
  const finished = await db.execute(sql`
    UPDATE notification_deliveries
       SET status=${status},
           lease_owner=NULL,
           lease_expires_at=NULL,
           next_attempt_at=CASE WHEN ${status}='retry'
             THEN now() + ${delay} * interval '1 second' ELSE NULL END,
           sent_at=CASE WHEN ${status}='sent' THEN now() ELSE sent_at END,
           error=${error}
     WHERE id=${delivery.id} AND status='processing'
       AND lease_owner=${workerId}
       AND attempt_count=${delivery.attempt_count}
       AND lease_expires_at>now()
     RETURNING id
  `);
  if (finished.rows.length !== 1) return 'lost_lease';
  return result.ok ? 'accepted' : exhausted ? 'dead_letter' : 'retry';
}

export type DispatchReport = {
  sent: number; failed: number;
  claimed: number; retried: number; deadLetter: number; lostLease: number; exhausted: number;
};

export type SendDelivery = typeof send;

/** Entrypoint do worker. Injeção opcional exclusivamente para testes isolados. */
export async function dispatchPending(
  limit = 100,
  options: { db?: DB; sendImpl?: SendDelivery; workerId?: string } = {},
): Promise<DispatchReport> {
  const db = options.db ?? await getDb();
  const workerId = options.workerId ?? randomUUID();
  const sendImpl = options.sendImpl ?? send;
  const exhausted = await sweepExhaustedDeliveries(db);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new Error('Limite do lote inválido (1 a 500)');
  const report: DispatchReport = {
    sent: 0, failed: 0, claimed: 0, retried: 0,
    deadLetter: 0, lostLease: 0, exhausted,
  };

  // Reservar imediatamente antes de enviar: se reservássemos 100 registros
  // e os enviassemos em sequência, o lease dos últimos expiraria ANTES do
  // envio, permitindo duplicação por outro worker. 1 reserva = 1 envio.
  for (let index=0; index<limit; index++) {
    const [item] = await claimPendingDeliveries(db, 1, workerId);
    if (!item) break;
    report.claimed++;
    let result: {ok:boolean;detail:string};
    try {
      result = await sendImpl({
        channel: item.channel, destination: item.destination,
        title: item.title, message: item.message,
      });
    } catch {
      // Erros brutos de SDK/transporte não devem entrar no banco nem em logs.
      result = {ok:false, detail:'Falha de transporte'};
    }
    const outcome = await finishClaimedDelivery(db,item,workerId,result);
    if (outcome === 'accepted') report.sent++;
    else if (outcome === 'lost_lease') report.lostLease++;
    else {
      report.failed++;
      if (outcome === 'retry') report.retried++;
      if (outcome === 'dead_letter') report.deadLetter++;
    }
  }
  return report;
}

/**
 * Reprocessamento manual SOMENTE após RBAC do proprietário. Reabertura da
 * dead letter e evento de auditoria no MESMO SQL, sem risco de reabrir sem
 * trilha; preserva dedupe_key e jamais cria outra entrega no histórico.
 */
export async function requeueDeadLetter(
  db: DB, input: {tenantId:number;deliveryId:number;actor:string;reason:string},
): Promise<boolean> {
  if (![input.tenantId, input.deliveryId].every(x => Number.isSafeInteger(x) && x > 0))
    throw new Error('Identificadores inválidos');
  if (!input.actor.trim() || input.actor.length > 120 ||
      input.reason.trim().length < 5 || input.reason.length > 300)
    throw new Error('Autor e justificativa de reprocessamento obrigatórios');
  const result = await db.execute(sql`
    WITH restored AS (
      UPDATE notification_deliveries
         SET status='queued', attempt_count=0,
             lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=NULL,
             error=NULL, sent_at=NULL
       WHERE id=${input.deliveryId} AND tenant_id=${input.tenantId}
         AND status='dead_letter'
       RETURNING id,tenant_id
    ), recorded AS (
      INSERT INTO audit_events(actor,tenant_id,action,target,reason)
      SELECT ${input.actor.trim()},tenant_id,'NOTIFICATION_REQUEUED',
        'notification_delivery:' || id::text,${input.reason.trim()}
      FROM restored
      RETURNING id
    )
    SELECT restored.id FROM restored CROSS JOIN recorded
  `);
  return result.rows.length === 1;
}
