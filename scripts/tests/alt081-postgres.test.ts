/**
 * ALT-08.1 — PostgreSQL real descartável, dois pools/conexões independentes.
 * Executar SOMENTE em CI com ALT081_EPHEMERAL_POSTGRES=1.
 * Nenhuma chamada HTTP, envio externo, migração em banco remoto ou dados reais.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../lib/db/schema';
import { ensureSchema, type DB } from '../../lib/db';
import {
  claimPendingDeliveries, finishClaimedDelivery, DELIVERY_MAX_ATTEMPTS,
} from '../../lib/notifications/queue';

const require = createRequire(import.meta.url);
if (process.env.ALT081_EPHEMERAL_POSTGRES !== '1')
  throw new Error('ALT081_EPHEMERAL_POSTGRES=1 obrigatório (teste destrutivo em banco descartável)');
if (process.env.PGHOST !== '127.0.0.1' || process.env.PGDATABASE !== 'vigia_alt081_ci')
  throw new Error('ALT-08.1 somente aceita PostgreSQL descartável local vigia_alt081_ci');
if (process.env.DATABASE_URL)
  throw new Error('DATABASE_URL remoto proibido neste teste');
const { Pool } = require('pg') as {Pool: new (options: Record<string, unknown>)=> {
  end():Promise<void>;
  query(text:string):Promise<unknown>;
}};
const options = {
  host: '127.0.0.1', port: 5432, database: 'vigia_alt081_ci',
  user: 'vigia_ci', password: process.env.PGPASSWORD,
  max: 2,
};
const poolA = new Pool(options);
const poolB = new Pool(options);
const dbA = drizzle(poolA as never,{schema}) as unknown as DB;
const dbB = drizzle(poolB as never,{schema}) as unknown as DB;
const suffix = randomUUID().slice(0, 8);

test('ALT-08.1 PostgreSQL: dois processos/conexões disputam item, crash+lease e dead-letter', async () => {
  try {
    await ensureSchema(dbA);
    const [tenant] = await dbA.insert(schema.tenants).values({
      name:'ALT081 PostgreSQL CI', slug:'alt081-pg-'+suffix,
      status:'active', alertRateLimitPerHour:100,
    }).returning();
    const [delivery] = await dbA.insert(schema.notificationDeliveries).values({
      tenantId:tenant.id, channel:'ledger',destination:'internal',
      kind:'incident',title:'Evento controlado',message:'Sem transporte',
      status:'queued', dedupeKey:'alt081-pg-'+suffix,
    }).returning();

    const [first,second] = await Promise.all([
      claimPendingDeliveries(dbA,1,'worker_alt081_pg_A'),
      claimPendingDeliveries(dbB,1,'worker_alt081_pg_B'),
    ]);
    assert.equal(first.length+second.length,1,'duas conexões não reivindicam o mesmo item');
    const current = first[0]??second[0];
    const owner = first.length?'worker_alt081_pg_A':'worker_alt081_pg_B';
    assert.equal(current.id,delivery.id);
    const initialLedger = await dbA.select().from(schema.notificationDispatchAttempts)
      .where(eq(schema.notificationDispatchAttempts.deliveryId,delivery.id));
    assert.equal(initialLedger.length,1);

    // Simula queda do worker owner: lease expira sem UPDATE de conclusão.
    await dbA.update(schema.notificationDeliveries)
      .set({leaseExpiresAt:new Date('2020-01-01T00:00:00Z')})
      .where(eq(schema.notificationDeliveries.id,delivery.id));
    const [reclaimed] = await claimPendingDeliveries(dbB,1,'worker_alt081_pg_RECOVER');
    assert.equal(reclaimed?.id,delivery.id);
    assert.equal(reclaimed.attempt_count,2);
    assert.equal(await finishClaimedDelivery(dbA,current,owner,
      {ok:true,detail:'HTTP 202'}),'lost_lease');
    assert.equal(await finishClaimedDelivery(dbB,reclaimed,'worker_alt081_pg_RECOVER',
      {ok:false,detail:'HTTP 503'}),'retry');

    // Retentativas não utilizam transporte real e são registradas por tentativa.
    for(let attempt=3;attempt<=DELIVERY_MAX_ATTEMPTS;attempt++){
      await dbA.update(schema.notificationDeliveries)
        .set({nextAttemptAt:new Date('2020-01-01T00:00:00Z')})
        .where(eq(schema.notificationDeliveries.id,delivery.id));
      const [claimed] = await claimPendingDeliveries(dbA,1,'worker_alt081_pg_RETRY');
      assert.equal(claimed?.attempt_count,attempt);
      assert.equal(await finishClaimedDelivery(dbA,claimed,'worker_alt081_pg_RETRY',
        {ok:false,detail:'HTTP 503'}),
        attempt===DELIVERY_MAX_ATTEMPTS?'dead_letter':'retry');
    }
    const [final] = await dbB.select().from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.id,delivery.id));
    assert.equal(final.status,'dead_letter');
    assert.equal((await dbA.select().from(schema.notificationDispatchAttempts)
      .where(eq(schema.notificationDispatchAttempts.deliveryId,delivery.id))).length,
      DELIVERY_MAX_ATTEMPTS);
    assert.equal((await claimPendingDeliveries(dbB,1,'worker_alt081_pg_DONE')).length,0);
  } finally {
    await Promise.all([poolA.end(),poolB.end()]);
  }
});

type ChildResult = { code:number|null; signal:NodeJS.Signals|null; stdout:string };
function subprocess(mode:'crash-after-claim'|'recover-and-finish'):Promise<ChildResult> {
  return new Promise((resolveResult,reject)=>{
    const child=spawn(process.execPath,['--import','tsx',
      resolve('scripts/tests/alt081-worker-process.ts'),mode],{
      env:{...process.env},stdio:['ignore','pipe','pipe'],shell:false,
    });
    let stdout='';let stderr='';
    child.stdout.on('data',(chunk:Buffer)=>{stdout+=chunk.toString('utf8').slice(0,500);});
    child.stderr.on('data',(chunk:Buffer)=>{stderr+=chunk.toString('utf8').slice(0,500);});
    const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Subprocesso excedeu 20s'));},20_000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('close',(code,signal)=>{
      clearTimeout(timer);
      if(code!==0 && signal!=='SIGKILL')reject(new Error('Subprocesso falhou: '+stderr));
      else resolveResult({code,signal,stdout});
    });
  });
}

test('ALT-08.1: concorrência entre processos Node e SIGKILL real preservam lease recuperável',async()=>{
  const [tenant]=await dbA.insert(schema.tenants).values({
    name:'ALT081 subprocess CI',slug:'alt081-process-'+suffix,
    status:'active',alertRateLimitPerHour:100,
  }).returning();
  const [delivery]=await dbA.insert(schema.notificationDeliveries).values({
    tenantId:tenant.id,channel:'ledger',destination:'internal',
    kind:'incident',title:'Crash de processo',message:'Sem transporte externo',
    dedupeKey:'alt081-process-'+suffix,status:'queued',
  }).returning();
  // Dois processos Node, cada um abre o próprio pool PostgreSQL.
  // O vencedor sofre SIGKILL após confirmar o claim; o perdedor não faz envio.
  const [a,b]=await Promise.all([
    subprocess('crash-after-claim'),
    subprocess('crash-after-claim'),
  ]);
  assert.equal([a,b].filter(r=>r.signal==='SIGKILL').length,1,
    'exatamente um processo assumiu e caiu com SIGKILL');
  assert.equal([a,b].filter(r=>r.code===0).length,1);
  const [afterCrash]=await dbA.select().from(schema.notificationDeliveries)
    .where(eq(schema.notificationDeliveries.id,delivery.id));
  assert.equal(afterCrash.status,'processing');
  assert.equal(afterCrash.attemptCount,1);
  assert.equal((await dbA.select().from(schema.notificationDispatchAttempts)
    .where(eq(schema.notificationDispatchAttempts.deliveryId,delivery.id))).length,1);
  await dbA.update(schema.notificationDeliveries)
    .set({leaseExpiresAt:new Date('2020-01-01T00:00:00Z')})
    .where(eq(schema.notificationDeliveries.id,delivery.id));
  const recovered=await subprocess('recover-and-finish');
  assert.equal(recovered.code,0);
  assert.match(recovered.stdout,/accepted/);
  const [final]=await dbA.select().from(schema.notificationDeliveries)
    .where(eq(schema.notificationDeliveries.id,delivery.id));
  assert.equal(final.status,'sent');
  assert.equal(final.attemptCount,2);
  assert.equal((await dbA.select().from(schema.notificationDispatchAttempts)
    .where(eq(schema.notificationDispatchAttempts.deliveryId,delivery.id))).length,2);
  await Promise.all([poolA.end(),poolB.end()]);
});
