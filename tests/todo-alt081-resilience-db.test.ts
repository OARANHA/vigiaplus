import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

// Banco isolado: nenhuma credencial de transporte ou banco remoto.
process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), 'vpx-alt081-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

test('ALT-08.1: dois workers concorrentes reivindicam uma entrega apenas uma vez', async () => {
  const { getDb } = await import('../lib/db');
  const { tenants, notificationDeliveries, notificationDispatchAttempts } = await import('../lib/db/schema');
  const { claimPendingDeliveries, finishClaimedDelivery } = await import('../lib/notifications/queue');
  const db = await getDb();
  const [tenant] = await db.insert(tenants).values({
    name: 'ALT081 Concorrência', slug:'alt081-concurrency', status:'active',
    alertRateLimitPerHour:100,
  }).returning();
  const [delivery] = await db.insert(notificationDeliveries).values({
    tenantId:tenant.id, channel:'ledger',destination:'internal', kind:'incident',
    title:'Evento fictício',message:'Sem transporte externo',
    dedupeKey:'alt081-concurrent',status:'queued',
  }).returning();
  const [a,b] = await Promise.all([
    claimPendingDeliveries(db,1,'worker_alt081_A'),
    claimPendingDeliveries(db,1,'worker_alt081_B'),
  ]);
  const claimed = [...a,...b];
  assert.equal(claimed.length,1, 'uma única reserva');
  assert.equal(claimed[0].id,delivery.id);
  assert.equal((await db.select().from(notificationDispatchAttempts)
    .where(eq(notificationDispatchAttempts.deliveryId,delivery.id))).length,1);
  const owner = a.length?'worker_alt081_A':'worker_alt081_B';
  assert.equal(await finishClaimedDelivery(db,claimed[0],owner,
    {ok:true,detail:'HTTP 202'}),'accepted');
  assert.equal((await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,delivery.id)))[0].status,'sent');
  assert.equal((await claimPendingDeliveries(db,1,'worker_alt081_C')).length,0);
});

test('ALT-08.1: lease expirado recupera claim, mas worker antigo perde direito de finalizar',async()=>{
  const { getDb } = await import('../lib/db');
  const { tenants, notificationDeliveries, notificationDispatchAttempts } = await import('../lib/db/schema');
  const { claimPendingDeliveries, finishClaimedDelivery } = await import('../lib/notifications/queue');
  const db = await getDb();
  const [tenant] = await db.insert(tenants).values({
    name:'ALT081 Crash',slug:'alt081-crash',status:'active',alertRateLimitPerHour:100,
  }).returning();
  const [delivery] = await db.insert(notificationDeliveries).values({
    tenantId:tenant.id,channel:'ledger',destination:'internal',kind:'incident',
    title:'Crash controlado',message:'Não enviar',dedupeKey:'alt081-crash',status:'queued',
  }).returning();
  const [first]=await claimPendingDeliveries(db,1,'worker_alt081_crash');
  assert.equal(first?.attempt_count,1);
  // Simular queda após claim e término do lease, sem alterar relógio do servidor.
  await db.update(notificationDeliveries)
    .set({leaseExpiresAt:new Date('2020-01-01T00:00:00Z')})
    .where(eq(notificationDeliveries.id,delivery.id));
  const [second]=await claimPendingDeliveries(db,1,'worker_alt081_recover');
  assert.equal(second?.id,delivery.id);
  assert.equal(second.attempt_count,2);
  assert.equal(await finishClaimedDelivery(db,first,'worker_alt081_crash',
    {ok:true,detail:'HTTP 202'}),'lost_lease');
  assert.equal(await finishClaimedDelivery(db,second,'worker_alt081_recover',
    {ok:true,detail:'HTTP 202'}),'accepted');
  const attempts=await db.select().from(notificationDispatchAttempts)
    .where(eq(notificationDispatchAttempts.deliveryId,delivery.id));
  assert.deepEqual(attempts.map(a=>a.attemptCount).sort(),[1,2]);
  assert.equal((await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,delivery.id)))[0].status,'sent');
});

test('ALT-08.1: retry tem backoff, consome nova tentativa e falha definitiva não reenvia',async()=>{
  const { getDb } = await import('../lib/db');
  const { tenants, notificationDeliveries, notificationDispatchAttempts } = await import('../lib/db/schema');
  const { claimPendingDeliveries, finishClaimedDelivery, DELIVERY_MAX_ATTEMPTS,
    sweepExhaustedDeliveries, retryDelaySeconds }=await import('../lib/notifications/queue');
  const db=await getDb();
  const [tenant]=await db.insert(tenants).values({
    name:'ALT081 Retry',slug:'alt081-retry',status:'active',alertRateLimitPerHour:100,
  }).returning();
  const [delivery]=await db.insert(notificationDeliveries).values({
    tenantId:tenant.id,channel:'ledger',destination:'internal',kind:'incident',
    title:'Retry',message:'Sem envio externo',dedupeKey:'alt081-retry',status:'queued',
  }).returning();
  assert.equal(retryDelaySeconds(1),60);
  for(let attempt=1;attempt<=DELIVERY_MAX_ATTEMPTS;attempt++){
    const [claimed]=await claimPendingDeliveries(db,1,'worker_alt081_retry');
    assert.equal(claimed?.id,delivery.id);
    assert.equal(claimed.attempt_count,attempt);
    const outcome=await finishClaimedDelivery(db,claimed,'worker_alt081_retry',
      {ok:false,detail:'HTTP 503'});
    assert.equal(outcome,attempt===DELIVERY_MAX_ATTEMPTS?'dead_letter':'retry');
    const [stored]=await db.select().from(notificationDeliveries)
      .where(eq(notificationDeliveries.id,delivery.id));
    if(attempt<DELIVERY_MAX_ATTEMPTS){
      assert.ok(stored.nextAttemptAt && stored.nextAttemptAt.getTime()>Date.now());
      assert.equal((await claimPendingDeliveries(db,1,'worker_alt081_early')).length,0);
      // Avançar elegibilidade no registro, sem aguardar e sem disparar transporte.
      await db.update(notificationDeliveries)
        .set({nextAttemptAt:new Date('2020-01-01T00:00:00Z')})
        .where(eq(notificationDeliveries.id,delivery.id));
    }else{
      assert.equal(stored.status,'dead_letter');
      assert.equal(stored.nextAttemptAt,null);
    }
  }
  assert.equal((await claimPendingDeliveries(db,1,'worker_alt081_after')).length,0);
  assert.equal(await sweepExhaustedDeliveries(db),0);
  assert.equal((await db.select().from(notificationDispatchAttempts)
    .where(eq(notificationDispatchAttempts.deliveryId,delivery.id))).length,
    DELIVERY_MAX_ATTEMPTS);
});
