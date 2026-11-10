import { NextResponse } from 'next/server';
import { and, eq, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { invitations } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { AppError } from '@/lib/tenant/errors';
import { isDemoMode } from '@/lib/session';
import { createClientInvitation, inviteEmail, inviteRole,
  revokeClientInvitation } from '@/lib/tenant/invitations';
import { send } from '@/lib/notifications/transport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(e:unknown) {
  if (e instanceof AppError) return NextResponse.json(
    {error:e.code,message:e.message},{status:e.status});
  return NextResponse.json({error:'INVITE_FAILED',message:'Não foi possível concluir a operação'},
    {status:500});
}
function int(v:unknown):number{
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<=0)throw AppError.badRequest('Identificador inválido');
  return n;
}
async function body(request:Request):Promise<Record<string,unknown>>{
  const raw=await request.text();
  if(raw.length>16384)throw AppError.badRequest('Pedido acima do limite permitido');
  const data=JSON.parse(raw) as unknown;
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw AppError.badRequest('JSON inválido');
  return data as Record<string,unknown>;
}
async function owner(){
  const ctx=await resolveTenantContext({surface:'console'});
  requireOwner(ctx);
  return ctx;
}

export async function GET(request:Request){
  try{
    await owner();
    const tenantId=int(new URL(request.url).searchParams.get('tenant_id'));
    const db=await getDb();
    const rows=await db.select({
      id:invitations.id,tenantId:invitations.tenantId,email:invitations.email,
      role:invitations.role,createdAt:invitations.createdAt,
      expiresAt:invitations.expiresAt,usedAt:invitations.usedAt,
      revokedAt:invitations.revokedAt,
    }).from(invitations).where(eq(invitations.tenantId,tenantId))
      .orderBy(desc(invitations.createdAt)).limit(100);
    const now=Date.now();
    return NextResponse.json({invitations:rows.map(i=>({
      id:i.id,tenantId:i.tenantId,email:i.email,role:i.role,createdAt:i.createdAt,
      expiresAt:i.expiresAt,status:i.revokedAt?'revogado':i.usedAt?'aceito':
        i.expiresAt.getTime()<=now?'expirado':'pendente',
    }))});
  }catch(e){return fail(e)}
}

export async function POST(request:Request){
  try{
    if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},{status:403});
    const ctx=await owner();
    const input=await body(request);
    const tenantId=int(input.tenantId);
    const email=inviteEmail(input.email);
    const role=inviteRole(input.role);
    const reason=typeof input.reason==='string'?input.reason.trim():'';
    const from=process.env.ALERT_EMAIL_FROM?.trim();
    const hasEmail=Boolean(process.env.RESEND_API_KEY?.trim()&&from);
    const configuredOrigin=process.env.PUBLIC_APP_URL?.trim();
    if(process.env.NODE_ENV==='production'&&(!hasEmail||!configuredOrigin||
      !/^https:\/\//.test(configuredOrigin))){
      return NextResponse.json({error:'INVITE_DELIVERY_NOT_CONFIGURED',
        message:'Configure Resend, remetente verificado e PUBLIC_APP_URL HTTPS antes de convidar'},
        {status:503});
    }
    const db=await getDb();
    const created=await createClientInvitation(db,{tenantId,email,role,
      actor:ctx.userName,reason});
    const base=configuredOrigin&&/^https:\/\//.test(configuredOrigin)
      ? configuredOrigin : new URL(request.url).origin;
    const url=new URL('/convite',base);
    url.searchParams.set('token',created.token);
    if(hasEmail){
      const result=await send({channel:'email',destination:email,
        title:'Seu acesso ao VigiaPlus',
        message:'Você recebeu um convite para o VigiaPlus. Abra o link seguro e crie sua senha (válido por 48 horas):\n'+url.toString()});
      if(!result.ok){
        await revokeClientInvitation(db,{tenantId,invitationId:created.id,
          actor:ctx.userName,reason:'Falha no aceite do envio pelo provedor'});
        return NextResponse.json({error:'INVITE_EMAIL_FAILED',
          message:'O provedor de e-mail não aceitou o convite; nenhum acesso foi criado'},
          {status:502});
      }
      return NextResponse.json({id:created.id,email,role,status:'aceito_pelo_provedor',
        message:'O provedor aceitou o e-mail. Entrega na caixa de entrada não confirmada'},
        {status:201});
    }
    // Exposição limitada à administração LOCAL de desenvolvimento (sem gateway).
    return NextResponse.json({id:created.id,email,role,status:'manual_dev',
      inviteUrl:url.toString(),
      message:'Entrega automática não configurada: copie o link apenas para teste local'},
      {status:201});
  }catch(e){return fail(e)}
}

export async function DELETE(request:Request){
  try{
    if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},{status:403});
    const ctx=await owner();
    const input=await body(request);
    const tenantId=int(input.tenantId),invitationId=int(input.invitationId);
    const reason=typeof input.reason==='string'?input.reason.trim():'';
    if(reason.length<5||reason.length>300)throw AppError.badRequest('Justifique a revogação');
    const ok=await revokeClientInvitation(await getDb(),{
      tenantId,invitationId,actor:ctx.userName,reason,
    });
    if(!ok)throw AppError.notFound('Convite não encontrado ou já utilizado');
    return NextResponse.json({ok:true,id:invitationId});
  }catch(e){return fail(e)}
}
