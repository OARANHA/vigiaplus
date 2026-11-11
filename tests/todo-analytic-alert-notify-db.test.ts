import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '../lib/db';
import { alerts, projects, tenants, notificationDeliveries } from '../lib/db/schema';
import { loadAnalyticAlertFacts } from '../lib/notifications/analytics-facts';
import { planDeliveries, ruleMatches, buildMessage, type RuleInput, type ChannelInput, type FactInput } from '../lib/notifications/evaluate';
import { enqueue } from '../lib/notifications/queue';

process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), 'vpx-alt03-analytics-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

const stamp = new Date('2026-11-11T00:02:00Z');
const incidentCreated = new Date('2026-11-10T23:58:00Z');
const channels: ChannelInput[] = [
  {channel:'email',destination:'admin@cliente.test',active:1,verified:1},
  {channel:'email',destination:'diretoria@cliente.test',active:1,verified:1},
  {channel:'telegram',destination:'112233',active:1,verified:0},
];
function rule(id:number,type:string):RuleInput{
  return {id,type,threshold:{severity:'media'},channels:[],
    silencioDe:null,silencioAte:null,slaMinutes:30,active:1};
}

test('ALT-03: anomalia persistida de volume/sentimento vira 2 notificações por fato, com correlação e sem cruzar tenants',async()=>{
  const db=await getDb();
  const [a,b]=await db.insert(tenants).values([
    {name:'ALT03 Empresa Alfa',slug:'alt03-alfa',status:'active'},
    {name:'ALT03 Empresa Beta',slug:'alt03-beta',status:'active'},
  ]).returning();
  const [pa,pb]=await db.insert(projects).values([
    {name:'Reputação Alfa',tenantId:a.id},
    {name:'Reputação Beta',tenantId:b.id},
  ]).returning();

  const [volume, sentiment, otherTenant, invalid, stale]=await db.insert(alerts).values([
    {projectId:pa.id,type:'volume_spike',severity:'high',
      message:'Aumento medido',data:{last24:35,avgDaily:5},createdAt:incidentCreated},
    {projectId:pa.id,type:'sentiment_drop',severity:'medium',
      message:'Queda medida',data:{avg24:-0.6,avgPrev:0.1},createdAt:incidentCreated},
    {projectId:pb.id,type:'volume_spike',severity:'high',
      message:'Dado da Beta',data:{last24:90,avgDaily:3},createdAt:incidentCreated},
    {projectId:pa.id,type:'sentiment_drop',severity:'high',
      message:'Dado insuficiente',data:{avg24:null,avgPrev:null},createdAt:incidentCreated},
    {projectId:pa.id,type:'volume_spike',severity:'high',
      message:'Alerta antigo',data:{last24:100,avgDaily:5},
      createdAt:new Date('2026-11-08T00:00:00Z')},
  ]).returning();

  const factsA=await loadAnalyticAlertFacts(db,a.id,stamp);
  const factsB=await loadAnalyticAlertFacts(db,b.id,stamp);
  assert.equal(factsA.length,2,'Alerta inválido ou antigo não vira fato');
  assert.equal(factsB.length,1);
  assert.deepEqual(new Set(factsA.map(f=>f.id)),new Set([volume.id,sentiment.id]));
  assert.equal(factsB[0].id,otherTenant.id);
  assert.ok(factsA.every(f=>f.projectId===pa.id));
  assert.ok(factsB.every(f=>f.projectId===pb.id));
  assert.ok(factsA.every(f=>f.ocorridoEm?.getTime()===incidentCreated.getTime()));

  const rules=[rule(501,'volume_pico'),rule(502,'sentimento_queda')];
  const plannedA=factsA.flatMap(f=>planDeliveries(rules,channels,f,stamp,a.id));
  assert.equal(plannedA.length,4);
  assert.ok(plannedA.every(x=>x.kind==='analytics'));
  assert.ok(plannedA.every(x=>x.sourceProjectId===pa.id));
  assert.equal(new Set(plannedA.map(x=>x.eventRef)).size,2);
  assert.ok(plannedA.some(x=>x.eventRef==='analytics:'+volume.id));
  assert.ok(plannedA.some(x=>x.eventRef==='analytics:'+sentiment.id));
  assert.ok(plannedA.every(x=>x.dedupeKey.startsWith('v2:')));
  assert.ok(plannedA.every(x=>x.message.includes('Base: Alerta #')));
  assert.ok(plannedA.every(x=>x.message.includes('projeto #'+pa.id)));
  assert.ok(plannedA.some(x=>x.message.includes('35')&&x.message.includes('5')));
  assert.ok(plannedA.some(x=>x.message.includes('-0,6')&&x.message.includes('0,1')));

  const scheduled=factsA.flatMap(f=>planDeliveries(rules,channels,f,
    new Date('2026-11-10T23:59:00Z'),a.id));
  assert.deepEqual(plannedA.map(x=>x.dedupeKey),scheduled.map(x=>x.dedupeKey),
    'Virada UTC não deve reenviar a mesma anomalia');
  assert.deepEqual(await Promise.all(plannedA.map(enqueue)),[true,true,true,true]);
  assert.deepEqual(await Promise.all(plannedA.map(enqueue)),[false,false,false,false]);

  const records=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId,a.id));
  assert.equal(records.length,4);
  assert.deepEqual(new Set(records.map(x=>x.eventRef)),
    new Set(['analytics:'+volume.id,'analytics:'+sentiment.id]));
  assert.ok(records.every(x=>x.sourceProjectId===pa.id&&x.status==='queued'));
  assert.equal((await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId,b.id))).length,0,
    'Nenhuma entrega criada automaticamente para tenant sem regra acionada');

  const plannedB=factsB.flatMap(f=>planDeliveries(rules,channels,f,stamp,b.id));
  assert.equal(plannedB.length,2);
  assert.deepEqual(await Promise.all(plannedB.map(enqueue)),[true,true]);
  assert.equal((await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId,b.id))).length,2);
});

test('ALT-03: sem fato medido/regra ativa/canal verificado, nenhuma entrega é criada',async()=>{
  const db=await getDb();
  const [tenant]=await db.insert(tenants).values({
    name:'ALT03 Sem Anomalias',slug:'alt03-sem-fatos',status:'active',
  }).returning();
  await db.insert(projects).values({name:'Projeto limpo',tenantId:tenant.id});
  const empty=await loadAnalyticAlertFacts(db,tenant.id,stamp);
  assert.deepEqual(empty,[]);
  assert.equal(empty.flatMap(f=>planDeliveries([rule(503,'volume_pico')],channels,f,stamp,tenant.id)).length,0);
  const invalid:FactInput={kind:'analytics',id:777,title:'Sem dados reais',
    severity:'high',anomalyType:'volume_spike'};
  assert.equal(ruleMatches(rule(501,'volume_pico'),invalid),false);
  assert.equal(ruleMatches(rule(502,'sentimento_queda'),invalid),false);
  assert.equal(ruleMatches(rule(501,'volume_pico'),{
    ...invalid,anomalyType:'sentiment_drop',avg24:-0.4,avgPrev:0.2,
  }),false);
  assert.equal(planDeliveries([rule(501,'volume_pico')],channels,invalid,stamp,tenant.id).length,0);
});

test('ALT-03: regras de análises não transformam incidentes ou faturas em anomalias',()=>{
  const inc:FactInput={kind:'incident',id:5,title:'Incidente real',severity:'high'};
  const bill:FactInput={kind:'billing',id:4,title:'Fatura real',severity:'high'};
  for(const kind of ['volume_pico','sentimento_queda']){
    assert.equal(ruleMatches(rule(10,kind),inc),false);
    assert.equal(ruleMatches(rule(10,kind),bill),false);
  }
  const valid:FactInput={kind:'analytics',anomalyType:'sentiment_drop',
    id:8,projectId:14,title:'Alvo',severity:'high',avg24:-0.7,avgPrev:0.2};
  const message=buildMessage(rule(20,'sentimento_queda'),valid);
  assert.ok(message.message.includes('alerta #8'));
  assert.ok(message.message.includes('projeto #14'));
  assert.ok(!message.message.includes('ontem'));
});
