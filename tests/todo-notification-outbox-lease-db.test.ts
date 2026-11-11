import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import {
  claimPendingDeliveries,
  dispatchPending,
  finishClaimedDelivery,
  requeueDeadLetter,
  retryDelaySeconds,
  sweepExhaustedDeliveries,
  DELIVERY_MAX_ATTEMPTS,
} from '../lib/notifications/queue';

process.env.PGLITE_DIR=mkdtempSync(join(tmpdir(),'vpx-outbox-lease-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

test('ALT-02: backoff exponencial determinístico, com teto e limites',()=>{
  assert.equal(retryDelaySeconds(1),60);
  assert.equal(retryDelaySeconds(2),120);
  assert.equal(retryDelaySeconds(3),240);
  assert.equal(retryDelaySeconds(4),480);
  assert.equal(retryDelaySeconds(5),960);
  assert.equal(retryDelaySeconds(99),3600);
  assert.equal(DELIVERY_MAX_ATTEMPTS,5);
});

async function insertTenant(name:string){
  const {getDb}=await import('../lib/db');
  const {tenants}=await import('../lib/db/schema');
  const db=await getDb();
  const [t]=await db.insert(tenants).values({
    name,slug:name.toLowerCase().replaceAll(' ','-'),status:'active',
  }).returning();
  return t.id;
}

async function enqueueFor(tenantId:number,unique:string){
  const {enqueue}=await import('../lib/notifications/queue');
  assert.equal(await enqueue({
    tenantId,ruleId:4,channel:'email',destination:unique+'@exemplo.test',
    kind:'incident',severity:'alta',title:'Atenção',message:'Fato real de teste',
    dedupeKey:'v2:'+unique.padEnd(64,'0').slice(0,64),
  }),true);
}

test('ALT-02: dois workers concorrentes reservam sem duplicar envios',async()=>{
  const {getDb}=await import('../lib/db');
  const {notificationDeliveries}=await import('../lib/db/schema');
  const db=await getDb();
  const tenantId=await insertTenant('Outbox Concorrencia');
  await enqueueFor(tenantId,'concorrencia-1');
  await enqueueFor(tenantId,'concorrencia-2');
  await enqueueFor(tenantId,'concorrencia-3');
  const invocations:string[]=[];
  const fakeSend=async(d:{destination:string})=>{
    invocations.push(d.destination);
    return {ok:true,detail:'HTTP 202'};
  };
  const [a,b]=await Promise.all([
    dispatchPending(20,{db,workerId:'worker_alpha_001',sendImpl:fakeSend}),
    dispatchPending(20,{db,workerId:'worker_beta_001',sendImpl:fakeSend}),
  ]);
  assert.equal(a.sent+b.sent,3);
  assert.equal(a.claimed+b.claimed,3);
  assert.equal(new Set(invocations).size,3);
  assert.equal(invocations.length,3);
  const rows=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId,tenantId));
  assert.equal(rows.length,3);
  assert.ok(rows.every(x=>x.status==='sent'&&x.sentAt!==null));
  assert.ok(rows.every(x=>x.attemptCount===1&&x.leaseOwner===null&&x.leaseExpiresAt===null));
  assert.equal((await dispatchPending(20,{db,workerId:'worker_gamma_001',sendImpl:fakeSend})).claimed,0);
  assert.equal(invocations.length,3);
});

test('ALT-02: HTTP 503 gera retry futuro e não reenvia antes do prazo',async()=>{
  const {getDb}=await import('../lib/db');
  const {notificationDeliveries}=await import('../lib/db/schema');
  const db=await getDb();
  const tenantId=await insertTenant('Outbox Retry');
  await enqueueFor(tenantId,'retry-1');
  let calls=0;
  const failed=await dispatchPending(1,{db,workerId:'worker_retry_001',sendImpl:async()=>{
    calls++;return {ok:false,detail:'HTTP 503'};
  }});
  assert.equal(failed.failed,1);
  assert.equal(failed.retried,1);
  const [item]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId,tenantId));
  assert.equal(item.status,'retry');
  assert.equal(item.attemptCount,1);
  assert.equal(item.error,'HTTP 503');
  assert.ok(item.nextAttemptAt && item.nextAttemptAt.getTime()>Date.now()+40_000);
  assert.equal((await dispatchPending(1,{db,workerId:'worker_retry_002',sendImpl:async()=>{
    calls++;return {ok:true,detail:'HTTP 202'};
  }})).claimed,0);
  assert.equal(calls,1);
  await db.update(notificationDeliveries).set({
    nextAttemptAt:new Date('2000-01-01T00:00:00Z'),
  }).where(eq(notificationDeliveries.id,item.id));
  const success=await dispatchPending(1,{db,workerId:'worker_retry_003',sendImpl:async()=>{
    calls++;return {ok:true,detail:'HTTP 202'};
  }});
  assert.equal(success.sent,1);
  assert.equal(calls,2);
  const [updated]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,item.id));
  assert.equal(updated.status,'sent');
  assert.equal(updated.attemptCount,2);
  assert.equal(updated.nextAttemptAt,null);
});

test('ALT-02: lease expirado pode ser retomado, worker antigo perde direito de finalizar',async()=>{
  const {getDb}=await import('../lib/db');
  const {notificationDeliveries}=await import('../lib/db/schema');
  const db=await getDb();
  const tenantId=await insertTenant('Outbox Crash');
  await enqueueFor(tenantId,'crash-1');
  const original=await claimPendingDeliveries(db,1,'worker_crash_001');
  assert.equal(original.length,1);
  assert.equal(original[0].attempt_count,1);
  assert.equal((await claimPendingDeliveries(db,1,'worker_crash_002')).length,0);
  await db.update(notificationDeliveries).set({
    leaseExpiresAt:new Date('2000-01-01T00:00:00Z'),
  }).where(eq(notificationDeliveries.id,original[0].id));
  const replacement=await claimPendingDeliveries(db,1,'worker_crash_002');
  assert.equal(replacement.length,1);
  assert.equal(replacement[0].attempt_count,2);
  assert.equal(await finishClaimedDelivery(db,original[0],'worker_crash_001',{
    ok:true,detail:'HTTP 200',
  }),'lost_lease');
  assert.equal(await finishClaimedDelivery(db,replacement[0],'worker_crash_002',{
    ok:true,detail:'HTTP 202',
  }),'accepted');
  const [final]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,original[0].id));
  assert.equal(final.status,'sent');
  assert.equal(final.attemptCount,2);
  assert.equal(final.leaseOwner,null);
});

test('ALT-02: quinta tentativa falha entra em dead_letter, só owner reabre com auditoria',async()=>{
  const {getDb}=await import('../lib/db');
  const {notificationDeliveries,auditEvents}=await import('../lib/db/schema');
  const db=await getDb();
  const tenantId=await insertTenant('Outbox Definitivo');
  const otherId=await insertTenant('Outbox Outro Cliente');
  await enqueueFor(tenantId,'terminal-1');
  const [created]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId,tenantId));
  await db.update(notificationDeliveries).set({attemptCount:4})
    .where(eq(notificationDeliveries.id,created.id));
  const failure=await dispatchPending(1,{db,workerId:'worker_terminal_01',sendImpl:async()=>{
    throw new Error('API_KEY_SECRETA_JAMAIS_LOGAR');
  }});
  assert.equal(failure.deadLetter,1);
  assert.equal(failure.failed,1);
  const [dead]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,created.id));
  assert.equal(dead.status,'dead_letter');
  assert.equal(dead.attemptCount,5);
  assert.equal(dead.nextAttemptAt,null);
  assert.equal(dead.leaseOwner,null);
  assert.ok(!String(dead.error).includes('API_KEY'));
  assert.equal((await dispatchPending(1,{db,workerId:'worker_terminal_02',sendImpl:async()=>{
    throw new Error('não pode ser chamada');
  }})).claimed,0);
  assert.equal(await requeueDeadLetter(db,{
    tenantId:otherId,deliveryId:created.id,actor:'Dono',reason:'Tentativa fora do cliente',
  }),false);
  assert.equal(await requeueDeadLetter(db,{
    tenantId,deliveryId:created.id,actor:'Dono',reason:'Revisado após falha do provedor',
  }),true);
  assert.equal(await requeueDeadLetter(db,{
    tenantId,deliveryId:created.id,actor:'Dono',reason:'Não pode repetir reabertura',
  }),false);
  const events=await db.select().from(auditEvents)
    .where(and(eq(auditEvents.tenantId,tenantId),eq(auditEvents.action,'NOTIFICATION_REQUEUED')));
  assert.equal(events.length,1);
  assert.equal(events[0].actor,'Dono');
  assert.equal((await dispatchPending(1,{db,workerId:'worker_terminal_03',
    sendImpl:async()=>({ok:true,detail:'HTTP 202'}),
  })).sent,1);
  const [sent]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,created.id));
  assert.equal(sent.status,'sent');
  assert.equal(sent.attemptCount,1);
});

test('ALT-02: lease esgotado por crash vira dead_letter sem novo envio',async()=>{
  const {getDb}=await import('../lib/db');
  const {notificationDeliveries}=await import('../lib/db/schema');
  const db=await getDb();
  const tenantId=await insertTenant('Outbox Esgotamento');
  await enqueueFor(tenantId,'esgotado-1');
  const [created]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId,tenantId));
  await db.update(notificationDeliveries).set({
    status:'processing',attemptCount:5,leaseOwner:'worker_crash_999',
    leaseExpiresAt:new Date('2000-01-01T00:00:00Z'),
  }).where(eq(notificationDeliveries.id,created.id));
  assert.equal(await sweepExhaustedDeliveries(db),1);
  const [after]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,created.id));
  assert.equal(after.status,'dead_letter');
  assert.equal(after.leaseOwner,null);
  assert.equal((await dispatchPending(1,{db,workerId:'worker_crash_1000',
    sendImpl:async()=>{throw Error('não deve enviar');},
  })).claimed,0);
});
