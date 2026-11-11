import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isDemoMode } from '@/lib/session';
import { verifyResendWebhook } from '@/lib/notifications/resend-signature';
import { parseResendDeliveryEvent,recordResendEvent } from '@/lib/notifications/resend-events';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
const MAX_BYTES=64*1024;

/**
 * Público somente para Resend (assinatura Svix obrigatória).
 * O corpo é verificado ANTES de JSON.parse. Não logar request, token,
 * assinatura, corpo, bounce.message ou e-mail.
 */
export async function POST(request:Request) {
  if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},
    {status:403,headers:HEADERS});
  const secret=process.env.RESEND_WEBHOOK_SECRET?.trim();
  if(!secret)return NextResponse.json({error:'WEBHOOK_NOT_CONFIGURED'},
    {status:503,headers:HEADERS});
  const bytes=Number(request.headers.get('content-length'));
  if(Number.isFinite(bytes)&&bytes>MAX_BYTES)
    return NextResponse.json({error:'PAYLOAD_TOO_LARGE'}, {status:413,headers:HEADERS});
  let body:string;
  try{body=await request.text();}catch{
    return NextResponse.json({error:'INVALID_BODY'},{status:400,headers:HEADERS});
  }
  if(Buffer.byteLength(body,'utf8')>MAX_BYTES)
    return NextResponse.json({error:'PAYLOAD_TOO_LARGE'},{status:413,headers:HEADERS});
  const verified=verifyResendWebhook(body,new Headers(request.headers),secret);
  if(!verified)return NextResponse.json({error:'INVALID_WEBHOOK_SIGNATURE'},
    {status:401,headers:HEADERS});
  let value:unknown;
  try{value=JSON.parse(body);}catch{
    return NextResponse.json({error:'INVALID_EVENT'},{status:400,headers:HEADERS});
  }
  const kind=value&&typeof value==='object'&&!Array.isArray(value)
    ? (value as {type?:unknown}).type:null;
  // Resend envia vários eventos de abertura/contatos: não criar entregas
  // de monitoramento a partir desses outros tipos.
  if(typeof kind!=='string'||![
      'email.sent','email.delivery_delayed','email.delivered','email.bounced',
      'email.complained','email.failed','email.suppressed',
    ].includes(kind)) {
    return NextResponse.json({ok:true,ignored:true},{headers:HEADERS});
  }
  const event=parseResendDeliveryEvent(value,verified.id);
  if(!event)return NextResponse.json({error:'INVALID_EVENT'},{status:422,headers:HEADERS});
  try{
    const outcome=await recordResendEvent(await getDb(),event);
    return NextResponse.json({ok:true,...outcome},{headers:HEADERS});
  }catch{
    // Resposta 5xx permite que o Resend repita o mesmo svix-id depois.
    return NextResponse.json({error:'WEBHOOK_PERSISTENCE_FAILED'},
      {status:503,headers:HEADERS});
  }
}
