import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isDemoMode } from '@/lib/session';
import { issuePasswordReset, revokePasswordReset } from '@/lib/password-recovery';
import { send } from '@/lib/notifications/transport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC = 'Se a conta existir e o serviço de e-mail estiver disponível, você receberá instruções para redefinir sua senha.';
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  if (isDemoMode()) return NextResponse.json({ error: 'DEMO_READ_ONLY' }, { status: 403, headers });

  // O endereço de origem deve vir apenas da configuração, jamais do Host enviado pelo cliente.
  const configured = process.env.PUBLIC_APP_URL?.trim();
  const from = process.env.ALERT_EMAIL_FROM?.trim();
  if (!process.env.RESEND_API_KEY?.trim() || !from || !configured) {
    return NextResponse.json({ error: 'EMAIL_NOT_CONFIGURED',
      message: 'Recuperação por e-mail ainda não está configurada.' }, { status: 503, headers });
  }
  let appUrl: URL;
  try {
    appUrl = new URL(configured);
    if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password ||
        appUrl.search || appUrl.hash) throw new Error('Origem inválida');
  } catch {
    return NextResponse.json({ error: 'RESET_ORIGIN_NOT_CONFIGURED',
      message: 'URL segura de recuperação ainda não está configurada.' }, { status: 503, headers });
  }

  const started = Date.now();
  try {
    const raw = await request.text();
    if (raw.length > 4096) return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' },
      { status: 413, headers });
    const input = JSON.parse(raw) as unknown;
    const email = input && typeof input === 'object' && !Array.isArray(input)
      ? (input as {email?:unknown}).email : null;
    const db = await getDb();
    const issued = await issuePasswordReset(db, email);
    if (issued) {
      const url = new URL('/redefinir', appUrl);
      url.searchParams.set('token', issued.token);
      try {
        const result = await send({channel:'email',destination:issued.email,
          title:'Redefina sua senha no VigiaPlus',
          message:'Foi solicitada uma redefinição de senha. Utilize o link abaixo em até 30 minutos. Se não foi você, ignore esta mensagem.\n'+url.toString()});
        if (!result.ok) await revokePasswordReset(db, issued.tokenId);
      } catch {
        await revokePasswordReset(db, issued.tokenId);
      }
    }
  } catch {
    // Não divulgar existência de usuário, senha ou estado do transporte na resposta.
  } finally {
    // Uniformizar parte do tempo observado em solicitações de contas válidas e inválidas.
    const elapsed = Date.now() - started;
    if (elapsed < 300) await new Promise(resolve => setTimeout(resolve, 300 - elapsed));
  }
  return NextResponse.json({ok:true,message:GENERIC}, {status:202,headers});
}
