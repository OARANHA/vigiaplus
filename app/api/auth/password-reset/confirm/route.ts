import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isDemoMode } from '@/lib/session';
import { AppError } from '@/lib/tenant/errors';
import { consumePasswordReset } from '@/lib/password-recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request:Request) {
  const headers = {'Cache-Control':'no-store'};
  if(isDemoMode()) return NextResponse.json({error:'DEMO_READ_ONLY'}, {status:403,headers});
  try {
    const raw = await request.text();
    if(raw.length>8192) return NextResponse.json({error:'PAYLOAD_TOO_LARGE'}, {status:413,headers});
    const value=JSON.parse(raw) as unknown;
    if(!value||typeof value!=='object'||Array.isArray(value))
      throw AppError.badRequest('JSON inválido');
    const data=value as Record<string,unknown>;
    if(data.password!==data.confirm) throw AppError.badRequest('As senhas não coincidem');
    await consumePasswordReset(await getDb(),data.token,data.password);
    // Não emitir cookie aqui. Todas as sessões antigas já foram invalidadas.
    return NextResponse.json({ok:true,redirectTo:'/login',
      message:'Senha atualizada. Entre novamente em sua conta.'},{headers});
  } catch(e){
    if(e instanceof AppError) return NextResponse.json({error:e.code,message:e.message},
      {status:e.status,headers});
    return NextResponse.json({error:'RESET_UNAVAILABLE',
      message:'Não foi possível completar a redefinição de senha.'},
      {status:500,headers});
  }
}
