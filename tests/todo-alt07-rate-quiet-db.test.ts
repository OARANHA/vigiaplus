import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

process.env.PGLITE_DIR=mkdtempSync(join(tmpdir(),'vpx-alt07-rate-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

test('ALT-07: limite por cliente e prioridade crítica são aplicados no claim SQL, sem descartar fila',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationChannels,notificationDeliveries,notificationDispatchAttempts}=await import('../lib/db/schema');
  const {dispatchPending}=await import('../lib/notifications/queue');
  const db=await getDb();
  const [alpha,beta]=await db.insert(tenants).values([
    {name:'ALT07 quota alfa',slug:'alt07-quota-alfa',status:'active',
      timeZone:'America/Sao_Paulo',alertRateLimitPerHour:1},
    {name:'ALT07 quota beta',slug:'alt07-quota-beta',status:'active',
      timeZone:'America/New_York',alertRateLimitPerHour:1},
  ]).returning();
  await db.insert(notificationChannels).values([
    {tenantId:alpha.id,channel:'email',destination:'a@example.test',
      active:1,verified:1,verifiedAt:new Date()},
    {tenantId:beta.id,channel:'email',destination:'b@example.test',
      active:1,verified:1,verifiedAt:new Date()},
  ]);
  const [low,urgent,other]=await db.insert(notificationDeliveries).values([
    {tenantId:alpha.id,channel:'email',destination:'a@example.test',
      kind:'incident',severity:'baixa',title:'Baixa',message:'Mensagem baixa',
      dedupeKey:'v2:alt07-low',status:'queued'},
    {tenantId:alpha.id,channel:'email',destination:'a@example.test',
      kind:'incident',severity:'critica',title:'Crítica',message:'Mensagem crítica',
      dedupeKey:'v2:alt07-crit',status:'queued',
      slaDueAt:new Date(Date.now()+5*60_000)},
    {tenantId:beta.id,channel:'email',destination:'b@example.test',
      kind:'incident',severity:'alta',title:'Beta',message:'Mensagem Beta',
      dedupeKey:'v2:alt07-beta',status:'queued'},
  ]).returning();
  const sent:string[]=[];
  const fakeSend=async (p:{title:string})=>{
    sent.push(p.title);return {ok:true,detail:'HTTP 202'};
  };
  const [r1,r2]=await Promise.all([
    dispatchPending(10,{db,workerId:'worker_alt07_a1',sendImpl:fakeSend}),
    dispatchPending(10,{db,workerId:'worker_alt07_b1',sendImpl:fakeSend}),
  ]);
  assert.equal(r1.sent+r2.sent,2,'uma tentativa por organização na mesma hora UTC');
  assert.equal(sent.length,2);
  assert.ok(sent.includes('Crítica'),'crítica selecionada antes da mensagem baixa');
  assert.ok(sent.includes('Beta'),'a quota de um tenant não bloqueia o outro');
  assert.ok(!sent.includes('Baixa'));
  let [left]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,low.id));
  assert.equal(left.status,'queued');
  assert.equal(left.attemptCount,0,'quota não consome tentativas nem apaga aviso');
  assert.equal((await dispatchPending(5,{db,workerId:'worker_alt07_c1',sendImpl:fakeSend})).claimed,0);
  // Simula avanço do bucket UTC sem modificar relógio global.
  // ALT-07 contabiliza TODAS as tentativas, inclusive retries, por ledger.
  await db.update(notificationDispatchAttempts)
    .set({claimedAt:new Date('2020-01-01T00:00:00Z')})
    .where(eq(notificationDispatchAttempts.deliveryId,urgent.id));
  const next=await dispatchPending(3,{db,workerId:'worker_alt07_d1',sendImpl:fakeSend});
  assert.equal(next.sent,1);
  assert.ok(sent.includes('Baixa'));
  [left]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,low.id));
  assert.equal(left.status,'sent');
  assert.equal((await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,other.id)))[0].status,'sent');
});

test('ALT-07: quiet hours é revalidado na fila, inclusive depois da mudança de regra',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationChannels,notificationDeliveries,alertRules}=await import('../lib/db/schema');
  const {claimPendingDeliveries,finishClaimedDelivery}=await import('../lib/notifications/queue');
  const db=await getDb();
  const [t]=await db.insert(tenants).values({
    name:'ALT07 silêncio',slug:'alt07-silencio',status:'active',
    timeZone:'UTC',alertRateLimitPerHour:100,criticalBypassSilence:0,
  }).returning();
  const [rule]=await db.insert(alertRules).values({
    tenantId:t.id,type:'crise_aberta',threshold:{severity:'media'},channels:[],
    silencioDe:'00:00',silencioAte:'23:59',slaMinutes:15,active:1,
  }).returning();
  await db.insert(notificationChannels).values({
    tenantId:t.id,channel:'email',destination:'silent@example.test',
    active:1,verified:1,verifiedAt:new Date(),
  });
  const [d]=await db.insert(notificationDeliveries).values({
    tenantId:t.id,ruleId:rule.id,channel:'email',destination:'silent@example.test',
    severity:'alta',kind:'incident',title:'A',message:'Em silêncio',
    dedupeKey:'v2:alt07-silence',status:'queued',
  }).returning();
  assert.equal((await claimPendingDeliveries(db,1,'worker_alt07_silent')).length,0);
  await db.update(tenants).set({criticalBypassSilence:1})
    .where(eq(tenants.id,t.id));
  await db.update(notificationDeliveries).set({severity:'critica'})
    .where(eq(notificationDeliveries.id,d.id));
  const [claimed]=await claimPendingDeliveries(db,1,'worker_alt07_crisis');
  assert.equal(claimed?.id,d.id,'crítica bypass com permissão explícita');
  assert.equal(await finishClaimedDelivery(db,claimed,'worker_alt07_crisis',
    {ok:true,detail:'HTTP 202'}),'accepted');
});

test('ALT-07: mudança administrativa exige owner e valida IANA, quota, silêncio e SLA',()=>{
  const policy=readFileSync('app/api/console/notifications/policy/route.ts','utf8');
  assert.match(policy,/requireOwner\(ctx\)/);
  assert.match(policy,/validTenantTimeZone\(timeZone\)/);
  assert.match(policy,/alertRateLimitPerHour/);
  assert.match(policy,/NOTIFICATION_POLICY_UPDATED/);
  assert.match(policy,/NOTIFICATION_RULE_TIMING_UPDATED/);
  assert.match(policy,/validateQuietWindow\(body\.silencioDe,body\.silencioAte\)/);
  assert.match(policy,/sla<1\|\|sla>10080/);
  const worker=readFileSync('scripts/workers/notify.ts','utf8');
  assert.match(worker,/timeZone: tenant\.timeZone/);
  assert.match(worker,/deferDuringSilence: true/);
  assert.match(worker,/invoiceIsPastDue\(inv\.status, inv\.dueAt, at, timeZone\)/);
  const queue=readFileSync('lib/notifications/queue.ts','utf8');
  assert.match(queue,/FOR UPDATE OF t SKIP LOCKED/);
  assert.match(queue,/date_trunc\('hour',now\(\)\)/);
});
