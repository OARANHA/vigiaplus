import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and,eq } from 'drizzle-orm';
import {
  issueChannelProof,consumeChannelProof,revokeChannelProof,channelHasProof,
  channelProofHash,emailForVerification,isChannelProofToken,
} from '../lib/notifications/channel-proof';
import { claimPendingDeliveries,finishClaimedDelivery } from '../lib/notifications/queue';

process.env.PGLITE_DIR=mkdtempSync(join(tmpdir(),'vpx-channel-proof-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

test('ALT-05: canal legado verified=1 sem prova não libera worker, token permite apenas após aceite',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationChannels,notificationDeliveries,notificationChannelProofs,auditEvents}
   =await import('../lib/db/schema');
  const db=await getDb();
  const [a,b]=await db.insert(tenants).values([
    {name:'ALT05 Alfa',slug:'alt05-alfa',status:'active'},
    {name:'ALT05 Beta',slug:'alt05-beta',status:'active'},
  ]).returning();
  const [channel]=await db.insert(notificationChannels).values({
    tenantId:a.id,channel:'email',destination:' Pessoa@Exemplo.test ',
    active:1,verified:1,
  }).returning();
  assert.equal(channelHasProof(channel),false,'flag legado isolado não prova posse');
  const [queued]=await db.insert(notificationDeliveries).values({
    tenantId:a.id,channel:'email',destination:channel.destination,
    kind:'incident',severity:'alta',title:'Alerta de teste',
    message:'Medido, não enviar até comprovar',status:'queued',
    dedupeKey:'v2:proof-alfa',
  }).returning();
  assert.equal((await claimPendingDeliveries(db,10,'worker_test_abc01')).length,0,
    'outbox não deve reivindicar destinatário sem prova');
  await assert.rejects(()=>issueChannelProof(db,b.id,channel.id),/não encontrado/i,
    'outro tenant não pode pedir prova do canal');
  const issued=await issueChannelProof(db,a.id,channel.id);
  assert.equal(issued.destination,'pessoa@exemplo.test');
  assert.equal(isChannelProofToken(issued.token),true);
  const [stored]=await db.select().from(notificationChannelProofs)
    .where(eq(notificationChannelProofs.channelId,channel.id));
  assert.equal(stored.tokenHash,channelProofHash(issued.token));
  assert.notEqual(stored.tokenHash,issued.token);
  assert.equal(stored.destination,channel.destination);
  await assert.rejects(()=>issueChannelProof(db,a.id,channel.id),/dez minutos/i);
  assert.equal((await claimPendingDeliveries(db,10,'worker_test_abc01')).length,0,
    'solicitar prova não é verificação');
  assert.equal(await consumeChannelProof(db,issued.token),channel.id);
  await assert.rejects(()=>consumeChannelProof(db,issued.token),/expirado|revogado|utilizado/i);
  const [verified]=await db.select().from(notificationChannels)
    .where(eq(notificationChannels.id,channel.id));
  assert.equal(channelHasProof(verified),true);
  const [claimed]=await claimPendingDeliveries(db,1,'worker_test_abc01');
  assert.equal(claimed?.id,queued.id);
  assert.equal(await finishClaimedDelivery(db,claimed,'worker_test_abc01',
    {ok:true,detail:'HTTP 202',providerId:'123-abc'}),'accepted');
  const [delivered]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.id,queued.id));
  assert.equal(delivered.status,'sent');
  assert.equal(delivered.providerMessageId,'123-abc');
  const events=await db.select().from(auditEvents)
    .where(and(eq(auditEvents.tenantId,a.id),
      eq(auditEvents.action,'NOTIFICATION_CHANNEL_VERIFIED')));
  assert.equal(events.length,1);
  assert.equal(events[0].target,'notification_channel:'+channel.id);
});

test('ALT-05: token revogado/expirado não habilita, canal não-email não recebe prova de email',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationChannels,notificationChannelProofs}=await import('../lib/db/schema');
  const db=await getDb();
  const [t]=await db.insert(tenants).values({name:'ALT05 Gamma',slug:'alt05-gamma',status:'active'}).returning();
  const [email,telegram]=await db.insert(notificationChannels).values([
    {tenantId:t.id,channel:'email',destination:'test@gamma.example',verified:0,active:1},
    {tenantId:t.id,channel:'telegram',destination:'123456',verified:1,active:1},
  ]).returning();
  assert.equal(channelHasProof(telegram),false);
  await assert.rejects(()=>issueChannelProof(db,t.id,telegram.id),/exclusivo para e-mail/i);
  const first=await issueChannelProof(db,t.id,email.id);
  await revokeChannelProof(db,first.tokenHash);
  await assert.rejects(()=>consumeChannelProof(db,first.token),/revogado/i);
  await db.update(notificationChannelProofs).set({
    requestedAt:new Date('2000-01-01T00:00:00Z'),
  }).where(eq(notificationChannelProofs.channelId,email.id));
  const next=await issueChannelProof(db,t.id,email.id);
  assert.notEqual(first.token,next.token);
  await db.update(notificationChannelProofs).set({expiresAt:new Date('2000-01-01T00:00:00Z')})
    .where(eq(notificationChannelProofs.channelId,email.id));
  await assert.rejects(()=>consumeChannelProof(db,next.token),/expirado/i);
  const [state]=await db.select().from(notificationChannels)
    .where(eq(notificationChannels.id,email.id));
  assert.equal(channelHasProof(state),false);
});

test('ALT-05: fluxo público não permite autoaprovação por PATCH e valida tokens',()=>{
  const src=readFileSync('app/api/notifications/channels/route.ts','utf8');
  assert.match(src,/toFlag\(body\.verified\) !== 0/);
  assert.match(src,/set\.verifiedAt = null/);
  const worker=readFileSync('scripts/workers/notify.ts','utf8');
  assert.match(worker,/channelHasProof\(c\)/);
  assert.equal(emailForVerification(' USER@EXAMPLE.COM '),'user@example.com');
  assert.equal(emailForVerification('sem-arroba'),null);
  assert.equal(isChannelProofToken('x'.repeat(43)),true);
  assert.equal(isChannelProofToken('x'.repeat(42)),false);
});
