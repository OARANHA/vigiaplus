import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenants, alertRules } from '@/lib/db/schema';
import { resolveTenantContext, appendAudit } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { AppError } from '@/lib/tenant/errors';
import { isDemoMode } from '@/lib/session';
import { validateQuietWindow,validTenantTimeZone } from '@/lib/notifications/tenant-time';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};

function idOf(value:unknown):number{
  const id=Number(value);
  if(!Number.isSafeInteger(id)||id<1)throw AppError.badRequest('Organização ou regra inválida');
  return id;
}
function bodyObj(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))
    throw AppError.badRequest('JSON inválido');
  return value as Record<string,unknown>;
}
function flag(value:unknown):0|1{
  if(value===1||value===true)return 1;
  if(value===0||value===false)return 0;
  throw AppError.badRequest('Flag inválido');
}
function failure(e:unknown){
  if(e instanceof AppError)return NextResponse.json({error:e.code,message:e.message},
    {status:e.status,headers:HEADERS});
  return NextResponse.json({error:'POLICY_OPERATION_FAILED'},
    {status:500,headers:HEADERS});
}
async function owner(){
  const ctx=await resolveTenantContext({surface:'console'});
  requireOwner(ctx);
  return ctx;
}

/** Configurações e regras visíveis apenas ao proprietário. */
export async function GET(request:Request){
  try{
    await owner();
    const tenantId=idOf(new URL(request.url).searchParams.get('tenant_id'));
    const db=await getDb();
    const [tenant]=await db.select({
      id:tenants.id,name:tenants.name,timeZone:tenants.timeZone,
      alertRateLimitPerHour:tenants.alertRateLimitPerHour,
      criticalBypassSilence:tenants.criticalBypassSilence,
    }).from(tenants).where(eq(tenants.id,tenantId)).limit(1);
    if(!tenant)throw AppError.notFound('Organização não encontrada');
    const rules=await db.select().from(alertRules).where(eq(alertRules.tenantId,tenantId));
    return NextResponse.json({tenant,rules},{headers:HEADERS});
  }catch(e){return failure(e);}
}

/** PATCH /api/console/notifications/policy — somente owner, auditável. */
export async function PATCH(request:Request){
  try{
    if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},
      {status:403,headers:HEADERS});
    const ctx=await owner();
    const raw=await request.text();
    if(raw.length>4096)throw AppError.badRequest('Pedido muito grande');
    let parsed:unknown;
    try{parsed=JSON.parse(raw);}catch{throw AppError.badRequest('JSON inválido');}
    const body=bodyObj(parsed);
    const tenantId=idOf(body.tenantId);
    const db=await getDb();
    const [exists]=await db.select({id:tenants.id}).from(tenants)
      .where(eq(tenants.id,tenantId)).limit(1);
    if(!exists)throw AppError.notFound('Organização não encontrada');

    if(body.scope==='tenant'){
      const timeZone=body.timeZone;
      if(!validTenantTimeZone(timeZone))
        throw AppError.badRequest('Fuso deve ser um identificador IANA válido');
      const rate=Number(body.alertRateLimitPerHour);
      if(!Number.isSafeInteger(rate)||rate<1||rate>1000)
        throw AppError.badRequest('Limite deve estar entre 1 e 1000 por hora');
      const critical=flag(body.criticalBypassSilence);
      await db.update(tenants).set({
        timeZone,alertRateLimitPerHour:rate,criticalBypassSilence:critical,
      }).where(eq(tenants.id,tenantId));
      await appendAudit(ctx,{
        action:'NOTIFICATION_POLICY_UPDATED',target:'tenant:'+tenantId,
        reason:'Política de horário e frequência alterada pelo proprietário',
      });
      return NextResponse.json({ok:true},{headers:HEADERS});
    }
    if(body.scope==='rule'){
      const ruleId=idOf(body.ruleId);
      let quiet:{start:string|null;end:string|null};
      try{quiet=validateQuietWindow(body.silencioDe,body.silencioAte);}
      catch{throw AppError.badRequest('Silêncio exige horários HH:mm válidos e uma janela com liberação');}
      const {start,end}=quiet;
      const sla=Number(body.slaMinutes);
      if(!Number.isSafeInteger(sla)||sla<1||sla>10080)
        throw AppError.badRequest('SLA de 1 a 10080 minutos');
      const active=flag(body.active);
      const [row]=await db.update(alertRules).set({
        silencioDe:start,silencioAte:end,slaMinutes:sla,active,
      }).where(and(eq(alertRules.id,ruleId),eq(alertRules.tenantId,tenantId)))
        .returning({id:alertRules.id});
      if(!row)throw AppError.notFound('Regra não encontrada neste cliente');
      await appendAudit(ctx,{
        action:'NOTIFICATION_RULE_TIMING_UPDATED',target:'rule:'+ruleId,
        reason:'Silêncio e SLA alterados pelo proprietário',
      });
      return NextResponse.json({ok:true},{headers:HEADERS});
    }
    throw AppError.badRequest('Escopo de configuração inválido');
  }catch(e){return failure(e);}
}
