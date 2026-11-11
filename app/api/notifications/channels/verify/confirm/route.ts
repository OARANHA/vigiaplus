import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isDemoMode } from '@/lib/session';
import { consumeChannelProof } from '@/lib/notifications/channel-proof';
import { AppError } from '@/lib/tenant/errors';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const HEADERS={'Cache-Control':'no-store'};
export async function POST(request:Request){
  if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},{status:403,headers:HEADERS});
  try{
    const raw=await request.text();
    if(raw.length>2048)throw AppError.badRequest('Pedido muito grande');
    let input:unknown;
    try{input=JSON.parse(raw);}catch{throw AppError.badRequest('JSON inválido');}
    if(!input||typeof input!=='object'||Array.isArray(input))
      throw AppError.badRequest('JSON inválido');
    const token=(input as {token?:unknown}).token;
    await consumeChannelProof(await getDb(),token);
    return NextResponse.json({ok:true,message:'E-mail confirmado. O canal de alerta está habilitado.'},
      {headers:HEADERS});
  }catch(e){
    if(e instanceof AppError)return NextResponse.json({error:e.code,message:e.message},
      {status:e.status,headers:HEADERS});
    return NextResponse.json({error:'CHANNEL_PROOF_FAILED',
      message:'Não foi possível verificar o destinatário.'},{status:500,headers:HEADERS});
  }
}
