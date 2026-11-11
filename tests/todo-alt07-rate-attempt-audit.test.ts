import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, gte } from 'drizzle-orm';
import { validateQuietWindow, nextQuietEnd } from '../lib/notifications/tenant-time';

process.env.PGLITE_DIR=mkdtempSync(join(tmpdir(),'vpx-alt07-audit-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

test('ALT-07: configuração de silêncio precisa liberar em algum horário',()=>{
  assert.deepEqual(validateQuietWindow(null,null),{start:null,end:null});
  assert.deepEqual(validateQuietWindow('22:00','06:00'),
    {start:'22:00',end:'06:00'});
  assert.throws(()=>validateQuietWindow('22:00',null),/Silêncio/);
  assert.throws(()=>validateQuietWindow('22:00','22:00'),/Silêncio/);
  assert.throws(()=>validateQuietWindow('00:00','23:59'),/Silêncio/);
  assert.throws(()=>validateQuietWindow('9:00','19:00'),/Silêncio/);
  // Política legada de 24h não derruba o worker: mantém mensagem represada,
  // aguardando correção da regra na interface administrativa.
  assert.equal(nextQuietEnd('00:00','23:59',
    new Date('2026-11-11T01:30:00Z'),'America/Sao_Paulo'),null);
});

test('ALT-07: quota limita lotes e registra cada claim, inclusive retry',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationChannels,notificationDeliveries,notificationDispatchAttempts}
    =await import('../lib/db/schema');
  const {claimPendingDeliveries,finishClaimedDelivery}=await import('../lib/notifications/queue');
  const db=await getDb();
  const [alfa,beta]=await db.insert(tenants).values([
    {name:'ALT07 Audit Alfa',slug:'alt07-audit-alfa',
      timeZone:'America/Sao_Paulo',status:'active',alertRateLimitPerHour:2},
    {name:'ALT07 Audit Beta',slug:'alt07-audit-beta',
      timeZone:'America/New_York',status:'active',alertRateLimitPerHour:1},
  ]).returning();
  await db.insert(notificationChannels).values([
    {tenantId:alfa.id,channel:'email',destination:'alfa@example.test',
      active:1,verified:1,verifiedAt:new Date()},
    {tenantId:beta.id,channel:'email',destination:'beta@example.test',
      active:1,verified:1,verifiedAt:new Date()},
  ]);
  const inserted=await db.insert(notificationDeliveries).values([
    {tenantId:alfa.id,channel:'email',destination:'alfa@example.test',
      status:'queued',kind:'incident',severity:'critica',
      title:'Alfa Crítico',message:'Crise',dedupeKey:'v2:alt07-audit-a'},
    {tenantId:alfa.id,channel:'email',destination:'alfa@example.test',
      status:'queued',kind:'incident',severity:'alta',
      title:'Alfa Alto',message:'Alerta',dedupeKey:'v2:alt07-audit-b'},
    {tenantId:alfa.id,channel:'email',destination:'alfa@example.test',
      status:'queued',kind:'incident',severity:'baixa',
      title:'Alfa Baixo',message:'Aviso',dedupeKey:'v2:alt07-audit-c'},
    {tenantId:beta.id,channel:'email',destination:'beta@example.test',
      status:'queued',kind:'incident',severity:'alta',
      title:'Beta Alto',message:'Aviso',dedupeKey:'v2:alt07-audit-d'},
  ]).returning();

  const [first,second]=await Promise.all([
    claimPendingDeliveries(db,10,'worker_alt07_audit_A'),
    claimPendingDeliveries(db,10,'worker_alt07_audit_B'),
  ]);
  const claimed=[...first,...second];
  assert.equal(claimed.length,3,'2+1 por tenant mesmo com batch=10 e concorrência');
  assert.equal(claimed.filter(x=>x.tenant_id===alfa.id).length,2);
  assert.equal(claimed.filter(x=>x.tenant_id===beta.id).length,1);
  assert.equal(new Set(claimed.map(x=>x.id)).size,3);
  assert.ok(!claimed.some(x=>x.id===inserted[2].id),'baixa prioridade deve aguardar');
  const audit=await db.select().from(notificationDispatchAttempts);
  assert.equal(audit.length,3);
  assert.equal(audit.filter(x=>x.tenantId===alfa.id).length,2);
  assert.equal((await claimPendingDeliveries(db,10,'worker_alt07_audit_C')).length,0,
    'limite alcançado não pode ser contornado com outro batch');

  const retry=claimed.find(x=>x.tenant_id===alfa.id)!;
  const owner=first.some(x=>x.id===retry.id)?'worker_alt07_audit_A':'worker_alt07_audit_B';
  assert.equal(await finishClaimedDelivery(db,retry,owner,{ok:false,detail:'HTTP 503'}),'retry');
  await db.update(notificationDeliveries).set({
    nextAttemptAt:new Date('2020-01-01T00:00:00Z'),
  }).where(eq(notificationDeliveries.id,retry.id));
  assert.equal((await claimPendingDeliveries(db,10,'worker_alt07_audit_D')).length,0,
    'retry também precisa consumir uma vaga da mesma quota');

  // Simular avanço da hora UTC apenas nos dados de auditoria (sem relógio global).
  await db.update(notificationDispatchAttempts)
    .set({claimedAt:new Date('2020-01-01T00:00:00Z')})
    .where(eq(notificationDispatchAttempts.tenantId,alfa.id));
  const continued=await claimPendingDeliveries(db,10,'worker_alt07_audit_E');
  assert.equal(continued.length,2,'retry e entrega baixa usam duas vagas novas');
  assert.ok(continued.some(x=>x.id===retry.id&&x.attempt_count===2));
  assert.ok(continued.some(x=>x.id===inserted[2].id));
  const recent=await db.select().from(notificationDispatchAttempts)
    .where(and(eq(notificationDispatchAttempts.tenantId,alfa.id),
      gte(notificationDispatchAttempts.claimedAt,new Date(Date.now()-3600_000))));
  assert.equal(recent.length,2);
  assert.equal((await db.select().from(notificationDispatchAttempts)).length,5);
});
