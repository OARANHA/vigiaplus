import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isDemoMode } from '@/lib/session';
import { resolveTenantContext, parseRequestedTenantId } from '@/lib/tenant/context';
import { requireAction } from '@/lib/tenant/rbac';
import { requireFeature } from '@/lib/tenant/entitlements';
import { AppError } from '@/lib/tenant/errors';
import { issueChannelProof, revokeChannelProof } from '@/lib/notifications/channel-proof';
import { publicHttpsOrigin, emailSetup } from '@/lib/notifications/email-config';
import { send } from '@/lib/notifications/transport';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};

export async function POST(request:Request){
  if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},{status:403,headers:HEADERS});
  try{
    const tenantIdRequested=parseRequestedTenantId(new URL(request.url).searchParams,request.headers);
    const ctx=await resolveTenantContext({surface:'app',requestedTenantId:tenantIdRequested});
    requireAction(ctx,'manage_notifications');
    await requireFeature(ctx,'crisis_management');
    if(!ctx.tenantId)throw AppError.badRequest('Organização necessária');
    const setup=emailSetup();
    if(!setup.readyForTest)
      return NextResponse.json({error:'EMAIL_NOT_CONFIGURED',message:'Configure Resend, remetente e URL HTTPS'},
        {status:503,headers:HEADERS});
    const raw=await request.text();
    if(raw.length>4096)throw AppError.badRequest('Pedido muito grande');
    let data:unknown;
    try{data=JSON.parse(raw)}catch{throw AppError.badRequest('JSON inválido');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw AppError.badRequest('JSON inválido');
    const channelId=Number((data as {channelId?:unknown}).channelId);
    const db=await getDb();
    const issued=await issueChannelProof(db,ctx.tenantId,channelId);
    const link=new URL('/confirmar-destino',publicHttpsOrigin());
    link.searchParams.set('token',issued.token);
    try{
      const result=await send({channel:'email',destination:issued.destination,
        title:'Confirme seu e-mail para alertas do VigiaPlus',
        message:'Para autorizar alertas neste endereço, acesse o link de confirmação em até 30 minutos:\n'+link.toString()+
          '\nSe não solicitou, ignore este aviso.',
        idempotencyKey:'vpx-proof/'+issued.tokenHash.slice(0,48)});
      if(!result.ok){
        await revokeChannelProof(db,issued.tokenHash);
        return NextResponse.json({error:'EMAIL_PROVIDER_REJECTED',
          message:'O provedor não aceitou a mensagem de confirmação. Nenhum canal foi verificado.'},
          {status:502,headers:HEADERS});
      }
    }catch{
      await revokeChannelProof(db,issued.tokenHash);
      return NextResponse.json({error:'EMAIL_PROVIDER_UNAVAILABLE',
        message:'Não foi possível solicitar a confirmação. Nenhum canal foi verificado.'},
        {status:502,headers:HEADERS});
    }
    return NextResponse.json({ok:true,status:'accepted_by_provider',
      message:'E-mail aceito pelo provedor. O canal permanece bloqueado até confirmar o link.'},
      {status:202,headers:HEADERS});
  }catch(e){
    if(e instanceof AppError)return NextResponse.json({error:e.code,message:e.message},
      {status:e.status,headers:HEADERS});
    return NextResponse.json({error:'CHANNEL_PROOF_UNAVAILABLE',
      message:'Verificação indisponível'},{status:500,headers:HEADERS});
  }
}
