/**
 * ALT-06 — Livro-razão e reconciliação de eventos assinados da Resend.
 * Nunca armazenar body original, headers ou texto do erro do provedor.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';

export const DELIVERY_EVENT_TYPES = [
  'email.sent','email.delivery_delayed','email.delivered',
  'email.bounced','email.complained','email.failed','email.suppressed',
] as const;
export type DeliveryEventType = typeof DELIVERY_EVENT_TYPES[number];
export type ResendDeliveryEvent = {
  eventId:string;providerMessageId:string;recipient:string;
  type:DeliveryEventType;occurredAt:Date;
};

const STATES:Record<DeliveryEventType,string>={
  'email.sent':'accepted',
  'email.delivery_delayed':'delayed',
  'email.delivered':'delivered',
  'email.bounced':'bounced',
  'email.complained':'complained',
  'email.failed':'failed',
  'email.suppressed':'suppressed',
};
// Eventos terminais sempre superam atrasos e aceites fora de ordem.
const PRIORITIES:Record<DeliveryEventType,number>={
  'email.sent':1,'email.delivery_delayed':2,
  'email.delivered':3,'email.bounced':4,
  'email.failed':4,'email.suppressed':4,'email.complained':5,
};
const CODES:Record<string,string>={
  bounced:'DELIVERY_BOUNCED',complained:'SPAM_COMPLAINT',
  failed:'DELIVERY_FAILED',suppressed:'DELIVERY_SUPPRESSED',
  delayed:'DELIVERY_DELAYED',
};

export function normalizeResendRecipient(input:unknown):string|null{
  if(typeof input!=='string')return null;
  const value=input.trim().toLowerCase();
  return value.length>=6&&value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? value:null;
}

export function parseResendDeliveryEvent(raw:unknown,eventId:string):ResendDeliveryEvent|null{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const value=raw as Record<string,unknown>;
  if(!DELIVERY_EVENT_TYPES.includes(value.type as DeliveryEventType))return null;
  if(!value.data||typeof value.data!=='object'||Array.isArray(value.data))return null;
  const data=value.data as Record<string,unknown>;
  const providerMessageId=data.email_id;
  const to=data.to;
  const occurredAt=typeof value.created_at==='string'?new Date(value.created_at):null;
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(String(providerMessageId??''))||
     !Array.isArray(to)||to.length!==1||
     !occurredAt||Number.isNaN(occurredAt.getTime()))return null;
  const recipient=normalizeResendRecipient(to[0]);
  if(!recipient)return null;
  return {eventId,providerMessageId:String(providerMessageId),recipient,
    type:value.type as DeliveryEventType,occurredAt};
}

export type ReconcileResult='unmatched'|'matched';

/**
 * Relaciona eventos pelo ID de aceite E destinatário. Sem um único matching,
 * não inferir tenant; manter evento órfão para próximo ciclo. O status é
 * recalculado a partir do ledger e não da ordem de chegada HTTP.
 */
export async function reconcileResendProvider(
  db:DB,providerMessageId:string,recipient:string,
):Promise<ReconcileResult>{
  const found=await db.execute(sql`
    SELECT id FROM notification_deliveries
    WHERE channel='email' AND provider_message_id=${providerMessageId}
      AND lower(btrim(destination))=${recipient}
    LIMIT 2
  `);
  if(found.rows.length!==1)return 'unmatched';
  const id=Number(found.rows[0].id);
  // Repetir é seguro e corrige interrupções após o registro do evento.
  await db.execute(sql`
    UPDATE notification_provider_events
      SET delivery_id=${id}
    WHERE delivery_id IS NULL AND provider_message_id=${providerMessageId}
      AND recipient=${recipient}
  `);
  const events=await db.execute(sql`
    SELECT event_type,occurred_at
    FROM notification_provider_events
    WHERE delivery_id=${id} AND provider_message_id=${providerMessageId}
      AND recipient=${recipient}
    ORDER BY occurred_at ASC,id ASC
  `);
  if(!events.rows.length)return 'matched';
  const sorted=events.rows.map(e=>({
    type:String(e.event_type) as DeliveryEventType,
    at:new Date(String(e.occurred_at)),
  }));
  sorted.sort((a,b)=>(PRIORITIES[b.type]??0)-(PRIORITIES[a.type]??0)
    ||b.at.getTime()-a.at.getTime());
  const winner=sorted[0];
  const state=STATES[winner.type];
  const delivered=sorted.filter(e=>e.type==='email.delivered')
    .sort((a,b)=>b.at.getTime()-a.at.getTime())[0];
  // Verificar o ID no WHERE novamente: um reprocessamento manual pode ter
  // substituído o provider_message_id enquanto a reconciliação estava ativa.
  const priority=PRIORITIES[winner.type];
  // CAS SQL: mesmo com dois callbacks simultâneos, nunca rebaixar estado
  // terminal para "delayed" ou "accepted", nem trocar evento mais recente
  // pelo mais antigo de mesma prioridade.
  await db.execute(sql`
    UPDATE notification_deliveries SET
      delivery_state=${state},delivery_state_at=${winner.at},
      delivered_at=COALESCE(${delivered?.at??null},delivered_at),
      delivery_failure_code=${CODES[state]??null}
    WHERE id=${id} AND provider_message_id=${providerMessageId}
      AND lower(btrim(destination))=${recipient}
      AND (
        (CASE delivery_state
          WHEN 'accepted' THEN 1 WHEN 'delayed' THEN 2
          WHEN 'delivered' THEN 3 WHEN 'bounced' THEN 4
          WHEN 'failed' THEN 4 WHEN 'suppressed' THEN 4
          WHEN 'complained' THEN 5 ELSE 0 END)<${priority}
        OR (
          (CASE delivery_state
            WHEN 'accepted' THEN 1 WHEN 'delayed' THEN 2
            WHEN 'delivered' THEN 3 WHEN 'bounced' THEN 4
            WHEN 'failed' THEN 4 WHEN 'suppressed' THEN 4
            WHEN 'complained' THEN 5 ELSE 0 END)=${priority}
          AND (delivery_state_at IS NULL OR delivery_state_at<=${winner.at})
        )
      )
  `);
  // Destinatário que reclamou ou recebeu bounce terminal não deve receber
  // avisos seguintes. Desativação limitada ao mesmo tenant e endereço.
  if(state==='bounced'||state==='complained'||state==='suppressed'){
    await db.execute(sql`
      UPDATE notification_channels c SET active=0
      FROM notification_deliveries d
      WHERE d.id=${id} AND d.provider_message_id=${providerMessageId}
        AND d.tenant_id=c.tenant_id AND c.channel='email'
        AND lower(btrim(c.destination))=${recipient}
    `);
  }
  return 'matched';
}

/** Duplicatas são reconhecidas no índice UNIQUE do webhook, sem processar 2x. */
export async function recordResendEvent(
  db:DB,event:ResendDeliveryEvent,
):Promise<{duplicate:boolean;matching:ReconcileResult}>{
  const inserted=await db.execute(sql`
    INSERT INTO notification_provider_events
      (webhook_id,provider_message_id,recipient,event_type,occurred_at)
    VALUES(${event.eventId},${event.providerMessageId},${event.recipient},
           ${event.type},${event.occurredAt})
    ON CONFLICT (webhook_id) DO NOTHING
    RETURNING id
  `);
  // Duplicata também refaz reconciliação — evita perda após crash entre
  // INSERT e UPDATE e permite recuperação quando provider_id chegou depois.
  const matching=await reconcileResendProvider(db,event.providerMessageId,event.recipient);
  return {duplicate:inserted.rows.length===0,matching};
}

/** Conciliação após aceite HTTP da API de envio: recupera webhooks adiantados. */
export async function reconcileAcceptedResendDelivery(
  db:DB,providerMessageId:string,recipient:string,
):Promise<void>{
  const canonical=normalizeResendRecipient(recipient);
  if(canonical)await reconcileResendProvider(db,providerMessageId,canonical);
}
