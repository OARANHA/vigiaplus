import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  validTenantTimeZone,tenantCivilTime,inQuietHours,nextQuietEnd,minuteFromHHmm,
} from '../lib/notifications/tenant-time';
import { isSilenced,planDeliveries, type RuleInput, type ChannelInput, type FactInput } from '../lib/notifications/evaluate';
import { invoiceIsPastDue } from '../lib/notifications/billing';

process.env.PGLITE_DIR=mkdtempSync(join(tmpdir(),'vpx-alt07-timezone-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

const quietRule:RuleInput={
  id:773,type:'crise_aberta',threshold:{severity:'media'},channels:[],
  silencioDe:'22:00',silencioAte:'06:00',slaMinutes:30,active:1,
};
const email:ChannelInput={channel:'email',destination:'alerta@exemplo.test',active:1,verified:1};
const incident:FactInput={kind:'incident',id:73,title:'Incidente confirmado',
  severity:'alta',ocorridoEm:new Date('2026-11-11T00:50:00Z')};

test('ALT-07: IANA validado, dia civil distinto de UTC e HH:mm estrito',()=>{
  assert.equal(validTenantTimeZone('America/Sao_Paulo'),true);
  assert.equal(validTenantTimeZone('America/New_York'),true);
  assert.equal(validTenantTimeZone('UTC'),true);
  for(const bad of ['America/Does_Not_Exist','Etc/../../etc','GMT-3','',42]){
    assert.equal(validTenantTimeZone(bad),false,String(bad));
  }
  assert.deepEqual(tenantCivilTime(new Date('2026-11-11T01:15:00Z'),'America/Sao_Paulo'),
    {day:'2026-11-10',hour:22,minute:15,minutes:1335});
  assert.equal(tenantCivilTime(new Date('2026-11-11T01:15:00Z'),'UTC').day,'2026-11-11');
  assert.equal(minuteFromHHmm('22:05'),1325);
  assert.equal(minuteFromHHmm('2:05'),null);
  assert.equal(minuteFromHHmm('24:00'),null);
  assert.equal(minuteFromHHmm('23:60'),null);
});

test('ALT-07: janela noturna em São Paulo atravessa meia-noite e adia sem perder',()=>{
  const now=new Date('2026-11-11T01:30:00Z'); // 10/11 22:30 BRT
  assert.equal(isSilenced(quietRule,now,'America/Sao_Paulo'),true);
  assert.equal(inQuietHours('22:00','06:00',new Date('2026-11-11T08:59:00Z'),
    'America/Sao_Paulo'),true);
  assert.equal(inQuietHours('22:00','06:00',new Date('2026-11-11T09:01:00Z'),
    'America/Sao_Paulo'),false);
  assert.equal(nextQuietEnd('22:00','06:00',now,'America/Sao_Paulo')?.toISOString(),
    '2026-11-11T09:01:00.000Z');

  const deferred=planDeliveries([quietRule],[email],incident,now,11,{
    timeZone:'America/Sao_Paulo',deferDuringSilence:true,
  });
  assert.equal(deferred.length,1,'não descartar alerta durante silêncio');
  assert.equal(deferred[0].nextAttemptAt?.toISOString(),'2026-11-11T09:01:00.000Z');
  assert.equal(deferred[0].slaDueAt?.toISOString(),'2026-11-11T01:20:00.000Z');
  assert.equal(planDeliveries([quietRule],[email],incident,now,11).length,1,
    'sem timezone explícito, mantém padrão UTC legado');
  const emergency=planDeliveries([quietRule],[email],{
    ...incident,id:74,severity:'critica'},now,11,{
      timeZone:'America/Sao_Paulo',deferDuringSilence:true,criticalBypassSilence:true,
    });
  assert.equal(emergency.length,1);
  assert.equal(emergency[0].nextAttemptAt,undefined,'crise crítica bypass só com opção');
  const emergencyNoBypass=planDeliveries([quietRule],[email],{
    ...incident,id:75,severity:'critica'},now,11,{
      timeZone:'America/Sao_Paulo',deferDuringSilence:true,criticalBypassSilence:false,
    });
  assert.ok(emergencyNoBypass[0].nextAttemptAt instanceof Date);
});

test('ALT-07: DST primavera e outono NY respeitam saltos e repetição local',()=>{
  const tz='America/New_York';
  assert.equal(tenantCivilTime(new Date('2026-03-08T06:59:00Z'),tz).hour,1);
  assert.equal(tenantCivilTime(new Date('2026-03-08T07:00:00Z'),tz).hour,3);
  assert.equal(inQuietHours('01:30','03:30',new Date('2026-03-08T07:10:00Z'),tz),true);
  assert.equal(nextQuietEnd('01:30','03:30',new Date('2026-03-08T06:45:00Z'),tz)?.toISOString(),
    '2026-03-08T07:31:00.000Z');
  const before=new Date('2026-11-01T05:30:00Z');
  const repeated=new Date('2026-11-01T06:30:00Z');
  assert.equal(tenantCivilTime(before,tz).minutes,90);
  assert.equal(tenantCivilTime(repeated,tz).minutes,90);
  assert.equal(inQuietHours('01:00','01:59',before,tz),true);
  assert.equal(inQuietHours('01:00','01:59',repeated,tz),true);
  assert.equal(nextQuietEnd('01:00','01:59',before,tz)?.toISOString(),
    '2026-11-01T07:00:00.000Z');
});

test('ALT-07: fatura aberta só vence quando a data local do cliente ultrapassa o due_at',()=>{
  assert.equal(invoiceIsPastDue('open','2026-11-10',
    new Date('2026-11-11T01:30:00Z'),'America/Sao_Paulo'),false);
  assert.equal(invoiceIsPastDue('open','2026-11-10',
    new Date('2026-11-11T03:01:00Z'),'America/Sao_Paulo'),true);
  assert.equal(invoiceIsPastDue('open','2026-11-10',
    new Date('2026-11-11T01:30:00Z'),'UTC'),true);
  assert.equal(invoiceIsPastDue('open','2026-11-12',
    new Date('2026-11-11T03:01:00Z'),'America/Sao_Paulo'),false);
  assert.equal(invoiceIsPastDue('paid','2026-11-09',
    new Date('2026-11-11T03:01:00Z'),'America/Sao_Paulo'),false);
  assert.equal(invoiceIsPastDue('open','2026-02-30',new Date(),'America/Sao_Paulo'),false);
});

test('ALT-07: SLA e dedupe de eventos acompanham cliente após virada UTC',()=>{
  const r:RuleInput={...quietRule,silencioDe:null,silencioAte:null};
  const a=planDeliveries([r],[email],incident,new Date('2026-11-11T01:30:00Z'),33,{
    timeZone:'America/Sao_Paulo',deferDuringSilence:true});
  const b=planDeliveries([r],[email],incident,new Date('2026-11-11T02:30:00Z'),33,{
    timeZone:'America/Sao_Paulo',deferDuringSilence:true});
  assert.equal(a[0].dedupeKey,b[0].dedupeKey);
  assert.ok(a[0].legacyDedupeKey?.endsWith('dia:2026-11-10'));
  assert.equal(a[0].slaDueAt?.toISOString(),'2026-11-11T01:20:00.000Z');
});

test('ALT-07: PGlite preserva next_attempt_at e prazo SLA em um alerta silenciado',async()=>{
  const {getDb}=await import('../lib/db');
  const {tenants,notificationDeliveries}=await import('../lib/db/schema');
  const {enqueue}=await import('../lib/notifications/queue');
  const db=await getDb();
  const [t]=await db.insert(tenants).values({
    name:'ALT07 Horário',slug:'alt07-horario',status:'active',
    timeZone:'America/Sao_Paulo',alertRateLimitPerHour:2,
  }).returning();
  const item=planDeliveries([quietRule],[email],incident,
    new Date('2026-11-11T01:30:00Z'),t.id,{
      timeZone:t.timeZone,deferDuringSilence:true,
    })[0];
  assert.equal(await enqueue(item),true);
  const [saved]=await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId,t.id));
  assert.equal(saved.nextAttemptAt?.toISOString(),'2026-11-11T09:01:00.000Z');
  assert.equal(saved.slaDueAt?.toISOString(),'2026-11-11T01:20:00.000Z');
  assert.equal(saved.status,'queued');
});
