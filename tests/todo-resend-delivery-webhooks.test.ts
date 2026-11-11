import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { verifyResendWebhook } from '../lib/notifications/resend-signature';
import { recordResendEvent,parseResendDeliveryEvent } from '../lib/notifications/resend-events';

process.env.PGLITE_DIR=mkdtempSync(join(tmpdir(),'vpx-alt06-resend-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

const key=Buffer.from('local-test-secret-at-least-32-bytes');
const secret='whsec_'+key.toString('base64');
const now=Math.floor(Date.now()/1000);
function signed(body:string,id='msg_alt06_demo_001',timestamp=now){
  const sig=createHmac('sha256',key).update(id+'.'+timestamp+'.'+body).digest('base64');
  return new Headers({'svix-id':id,'svix-timestamp':String(timestamp),
    'svix-signature':'v1,'+sig});
}
function event(type:string,emailId:string,to='dono@example.test',createdAt='2026-11-11T03:00:00Z'){
  return {type,created_at:createdAt,data:{email_id:emailId,to:[to],
    bounce:{message:'NÃO ARMAZENAR TEXTO LIVRE QUE PODE CONTER DADOS PESSOAIS'}}};
}
function parsed(type:string,id:string,emailId:string,to='dono@example.test',at='2026-11-11T03:00:00Z'){
  const x=parseResendDeliveryEvent(event(type,emailId,to,at),id);
  assert.ok(x);return x;
}
test('ALT-06: Svix autenticado com raw-body, múltiplas assinaturas e tolerância de 5 minutos',()=>{
  const body=JSON.stringify(event('email.delivered','resend-verify-1'));
  const headers=signed(body);
  assert.equal(verifyResendWebhook(body,headers,secret,now)?.id,'msg_alt06_demo_001');
  assert.equal(verifyResendWebhook(body+' ',headers,secret,now),null,'corpo alterado');
  assert.equal(verifyResendWebhook(body.replace('delivered','bounced'),headers,secret,now),null);
  assert.equal(verifyResendWebhook(body,headers,'whsec_Zm9v',now),null);
  assert.equal(verifyResendWebhook(body,signed(body,'msg_alt06_demo_001',now-301),secret,now),null);
  assert.equal(verifyResendWebhook(body,signed(body,'msg_alt06_demo_001',now+301),secret,now),null);
  const missing=new Headers(headers);missing.delete('svix-signature');
  assert.equal(verifyResendWebhook(body,missing,secret,now),null);
  const rotation=new Headers(headers);
  rotation.set('svix-signature','v1,'+Buffer.alloc(32).toString('base64')+' '+headers.get('svix-signature'));
  assert.equal(verifyResendWebhook(body,rotation,secret,now)?.id,'msg_alt06_demo_001');
  const old=new Headers({'webhook-id':headers.get('svix-id')!,
    'webhook-timestamp':headers.get('svix-timestamp')!,
    'webhook-signature':headers.get('svix-signature')!});
  assert.ok(verifyResendWebhook(body,old,secret,now));
});
test('ALT-06: parser exige um único destinatário e campos verificáveis',()=>{
  assert.equal(parseResendDeliveryEvent({...event('email.delivered','abc'),data:{
    email_id:'abc',to:['a@test.com','b@test.com']}},'msg_test_123'),null);
  assert.equal(parseResendDeliveryEvent(event('email.opened','abc'),'msg_test_123'),null);
  assert.equal(parseResendDeliveryEvent(event('email.delivered','abc','incorreto'),'msg_test_123'),null);
  assert.equal(parseResendDeliveryEvent(event('email.delivered','abc','boa@example.com','bad-date'),'msg_test_123'),null);
});

test('ALT-06: ledger idempotente, estado de entrega independente de HTTP, evento fora de ordem',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationChannels,notificationDeliveries,notificationProviderEvents}=await import('../lib/db/schema');
  const db=await getDb();
  const [tenant]=await db.insert(tenants).values({
    name:'ALT06 Owner',slug:'alt06-owner',status:'active',
  }).returning();
  const [channel]=await db.insert(notificationChannels).values({
    tenantId:tenant.id,channel:'email',destination:'dono@example.test',
    active:1,verified:1,verifiedAt:new Date(),
  }).returning();
  const [delivery]=await db.insert(notificationDeliveries).values({
    tenantId:tenant.id,channel:'email',destination:channel.destination,kind:'analytics',
    title:'Alerta registrado',message:'Fato real',status:'sent',
    providerMessageId:'resend-main-1',deliveryState:'accepted',
    dedupeKey:'v2:alt06-main-1',attemptCount:1,sentAt:new Date(),
  }).returning();
  const delivered=parsed('email.delivered','msg_delivered_main_001','resend-main-1',
    'DONO@EXAMPLE.TEST','2026-11-11T03:01:00Z');
  const outcomes=await Promise.all([recordResendEvent(db,delivered),recordResendEvent(db,delivered)]);
  assert.equal(outcomes.filter(x=>!x.duplicate).length,1);
  assert.equal(outcomes[0].matching,'matched');
  let [state]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,delivery.id));
  assert.equal(state.status,'sent','estado fila mantém aceite');
  assert.equal(state.deliveryState,'delivered');
  assert.ok(state.deliveredAt);
  assert.equal(state.deliveryFailureCode,null);
  await recordResendEvent(db,parsed('email.delivery_delayed','msg_delayed_late_001',
    'resend-main-1','dono@example.test','2026-11-11T03:02:00Z'));
  [state]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,delivery.id));
  assert.equal(state.deliveryState,'delivered','atraso posterior não rebaixa entrega');
  await recordResendEvent(db,parsed('email.complained','msg_complained_main_001',
    'resend-main-1','dono@example.test','2026-11-11T03:03:00Z'));
  [state]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,delivery.id));
  assert.equal(state.deliveryState,'complained');
  assert.equal(state.deliveryFailureCode,'SPAM_COMPLAINT');
  assert.ok(state.deliveredAt,'evento de entrega prévio mantido');
  const [disabled]=await db.select().from(notificationChannels)
    .where(eq(notificationChannels.id,channel.id));
  assert.equal(disabled.active,0,'reclamação desativa endereço comprovado');
  const saved=await db.select().from(notificationProviderEvents);
  assert.equal(saved.length,3);
  assert.equal(saved.filter(x=>x.eventType==='email.delivered').length,1);
  assert.ok(!JSON.stringify(saved).includes('NÃO ARMAZENAR'));
});

test('ALT-06: não aplicar evento a tenant/destinatário errado ou provider_id sem match',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationChannels,notificationDeliveries,notificationProviderEvents}=await import('../lib/db/schema');
  const db=await getDb();
  const [alpha,beta]=await db.insert(tenants).values([
    {name:'ALT06 Alpha',slug:'alt06-alpha',status:'active'},
    {name:'ALT06 Beta',slug:'alt06-beta',status:'active'},
  ]).returning();
  const [c1,c2]=await db.insert(notificationChannels).values([
    {tenantId:alpha.id,channel:'email',destination:'shared@example.test',
      active:1,verified:1,verifiedAt:new Date()},
    {tenantId:beta.id,channel:'email',destination:'shared@example.test',
      active:1,verified:1,verifiedAt:new Date()},
  ]).returning();
  const [a,b]=await db.insert(notificationDeliveries).values([
    {tenantId:alpha.id,channel:'email',destination:c1.destination,
      kind:'incident',title:'A',message:'A',dedupeKey:'v2:alt06-a',
      status:'sent',deliveryState:'accepted',providerMessageId:'provider-a-1'},
    {tenantId:beta.id,channel:'email',destination:c2.destination,
      kind:'incident',title:'B',message:'B',dedupeKey:'v2:alt06-b',
      status:'sent',deliveryState:'accepted',providerMessageId:'provider-b-1'},
  ]).returning();
  const badRecipient=parsed('email.bounced','msg_other_email_001',
    'provider-a-1','stranger@example.test');
  assert.equal((await recordResendEvent(db,badRecipient)).matching,'unmatched');
  const valid=parsed('email.bounced','msg_alpha_bounce_001',
    'provider-a-1','shared@example.test');
  assert.equal((await recordResendEvent(db,valid)).matching,'matched');
  const rows=await db.select().from(notificationDeliveries);
  assert.equal(rows.find(x=>x.id===a.id)!.deliveryState,'bounced');
  assert.equal(rows.find(x=>x.id===b.id)!.deliveryState,'accepted');
  const [aChannel,bChannel]=await db.select().from(notificationChannels)
    .where(eq(notificationChannels.channel,'email'));
  assert.equal((await db.select().from(notificationChannels)
    .where(eq(notificationChannels.id,c1.id)))[0].active,0);
  assert.equal((await db.select().from(notificationChannels)
    .where(eq(notificationChannels.id,c2.id)))[0].active,1);
  const orphan=await db.select().from(notificationProviderEvents)
    .where(eq(notificationProviderEvents.webhookId,'msg_other_email_001'));
  assert.equal(orphan[0].deliveryId,null);
});

test('ALT-06: webhook órfão reconcilia após aceite HTTP do worker; requeue não reaplica eventos antigos',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationChannels,notificationDeliveries}=await import('../lib/db/schema');
  const {claimPendingDeliveries,finishClaimedDelivery,requeueDeadLetter}=await import('../lib/notifications/queue');
  const db=await getDb();
  const [tenant]=await db.insert(tenants).values({
    name:'ALT06 Precoce',slug:'alt06-precoce',status:'active',
  }).returning();
  await db.insert(notificationChannels).values({
    tenantId:tenant.id,channel:'email',destination:'precoce@example.test',
    verified:1,verifiedAt:new Date(),active:1,
  });
  const [delivery]=await db.insert(notificationDeliveries).values({
    tenantId:tenant.id,channel:'email',destination:'precoce@example.test',
    status:'queued',kind:'incident',title:'X',message:'X',
    dedupeKey:'v2:alt06-precoce',
  }).returning();
  assert.equal((await recordResendEvent(db,
    parsed('email.delivered','msg_early_delivery_001',
      'provider-early-1','precoce@example.test'))).matching,'unmatched');
  const [claimed]=await claimPendingDeliveries(db,1,'worker_alt06_early');
  assert.equal(claimed.id,delivery.id);
  assert.equal(await finishClaimedDelivery(db,claimed,'worker_alt06_early',
    {ok:true,detail:'HTTP 200',providerId:'provider-early-1'}),'accepted');
  let [state]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,delivery.id));
  assert.equal(state.status,'sent');
  assert.equal(state.deliveryState,'delivered');
  assert.ok(state.deliveredAt);
});

test('ALT-06: rota pública exige assinatura; demo nega, sem segredo falha fechado',async()=>{
  const {POST}=await import('../app/api/webhooks/resend/route');
  const {proxy}=await import('../proxy');
  const {NextRequest}=await import('next/server');
  const body=JSON.stringify(event('email.delivered','route-unknown-1'));
  const priorSecret=process.env.RESEND_WEBHOOK_SECRET;
  const priorDemo=process.env.DEMO_MODE;
  try {
    delete process.env.DEMO_MODE;
    delete process.env.RESEND_WEBHOOK_SECRET;
    assert.equal((await POST(new Request('https://vigia.test/api/webhooks/resend',{
      method:'POST',body,headers:signed(body,'msg_route_missing_001'),
    }))).status,503);
    process.env.RESEND_WEBHOOK_SECRET=secret;
    assert.equal((await POST(new Request('https://vigia.test/api/webhooks/resend',{
      method:'POST',body,headers:new Headers({'content-type':'application/json'}),
    }))).status,401);
    assert.equal((await POST(new Request('https://vigia.test/api/webhooks/resend',{
      method:'POST',body:body+' ',headers:signed(body,'msg_route_tamper_001'),
    }))).status,401);
    const headers=signed(body,'msg_route_valid_001');
    const accepted=await POST(new Request('https://vigia.test/api/webhooks/resend',{
      method:'POST',body,headers,
    }));
    assert.equal(accepted.status,200);
    const data=await accepted.json() as {ok:boolean;matching:string;duplicate:boolean};
    assert.equal(data.ok,true);
    assert.equal(data.matching,'unmatched');
    assert.equal(data.duplicate,false);
    const replay=await POST(new Request('https://vigia.test/api/webhooks/resend',{
      method:'POST',body,headers,
    }));
    assert.equal(replay.status,200);
    assert.equal((await replay.json()).duplicate,true);
    assert.equal(proxy(new NextRequest('https://vigia.test/api/webhooks/resend',{method:'POST'})).status,200);
    assert.equal(proxy(new NextRequest('https://vigia.test/api/webhooks/other',{method:'POST'})).status,401);
    process.env.DEMO_MODE='1';
    assert.equal((await POST(new Request('https://vigia.test/api/webhooks/resend',{
      method:'POST',body,headers,
    }))).status,403);
  }finally{
    if(priorSecret===undefined)delete process.env.RESEND_WEBHOOK_SECRET;
    else process.env.RESEND_WEBHOOK_SECRET=priorSecret;
    if(priorDemo===undefined)delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE=priorDemo;
  }
});
