import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { acceptClientInvitation, looksLikeInviteToken, invitePassword } from '@/lib/tenant/invitations';
import { AppError } from '@/lib/tenant/errors';
import { isDemoMode } from '@/lib/session';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  if(isDemoMode())return NextResponse.json({error:'DEMO_READ_ONLY'},{status:403});
  let data:Record<string,unknown>;
  try{
    const raw=await request.text();
    if(raw.length>8192)return NextResponse.json({error:'PAYLOAD_TOO_LARGE'},{status:413});
    const input=JSON.parse(raw) as unknown;
    if(!input||typeof input!=='object'||Array.isArray(input))
      throw AppError.badRequest('JSON inválido');
    data=input as Record<string,unknown>;
    if(!looksLikeInviteToken(data.token))
      throw AppError.badRequest('Token de convite inválido');
    const name=typeof data.name==='string'?data.name.trim():'';
    const password=invitePassword(data.password);
    if(data.confirm!==password)throw AppError.badRequest('Confirmação da senha não corresponde');
    await acceptClientInvitation(await getDb(),data.token,name,password);
    return NextResponse.json({ok:true,redirectTo:'/login',
      message:'Conta criada. Entre com seu e-mail e a senha escolhida.'});
  }catch(e){
    if(e instanceof AppError)return NextResponse.json({error:e.code,message:e.message},
      {status:e.status});
    return NextResponse.json({error:'INVITE_FAILED',message:'Não foi possível aceitar o convite'},
      {status:500});
  }
}
