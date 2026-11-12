import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { verifyPasswordHash } from '@/lib/password';
import { revokeAllSessions } from '@/lib/session-auth';
import { SESSION_COOKIE, isDemoMode, signSession } from '@/lib/session';
import {
  loginLimitKeys, loginBlockRemainingSeconds, recordFailedLogin, clearSuccessfulLogin,
  loginTooManyResponseHeaders,
} from '@/lib/auth-rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown; logout?: boolean; revokeAll?: boolean };
  try {
    const payload = await req.text();
    if (payload.length > 16_384) {
      return NextResponse.json({ error: 'requisição muito grande' }, { status: 413 });
    }
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON inválido');
    body = parsed as typeof body;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Logout: cancella il cookie di sessione
  if (body.logout) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  }

  // Revoca TUTTE le sessioni dell'utente corrente ("esci da tutti i dispositivi"):
  // incrementare users.session_version invalida ogni cookie firmato finora.
  // Correzione P0 dell'audit: la verifica passa da authenticateSession, che
  // controlla FIRMA + ESISTENZA dell'utente + VERSIONE della sessione sul DB
  // PRIMA del bump. Un cookie la cui sessione è GIÀ stata revogata (firma
  // HMAC valida, versione superata) viene rifiutato con 401: una sessione
  // morta non può revocare niente.
  if (body.revokeAll) {
    if (isDemoMode()) {
      return NextResponse.json({ error: 'demo mode: read-only' }, { status: 403 });
    }
    const cookieHeader = req.headers.get('cookie') ?? '';
    const m = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    const db = await getDb();
    const outcome = await revokeAllSessions(db, m ? decodeURIComponent(m[1]) : undefined);
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.reason === 'revoked' ? 'sessione già revocata' : 'non autorizzato' },
        { status: 401 },
      );
    }
    const res = NextResponse.json({ ok: true, revokedSessions: 'all' });
    // Rilascia subito anche il cookie di QUESTO dispositivo.
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password.trim() : '';
  if (!email || !password || email.length > 320 || password.length > 4096) {
    return NextResponse.json({ error: 'credenciais inválidas' }, { status: 400 });
  }
  const db = await getDb();
  const limits = loginLimitKeys(email, req.headers);
  const remaining = await loginBlockRemainingSeconds(db, limits);
  if (remaining > 0) {
    return NextResponse.json({ error: 'muitas tentativas; tente novamente mais tarde' }, {
      status: 429, headers: loginTooManyResponseHeaders(remaining),
    });
  }

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || !verifyPasswordHash(password, user.passwordHash)) {
    await recordFailedLogin(db, limits);
    const blocked = await loginBlockRemainingSeconds(db, limits);
    if (blocked > 0) {
      return NextResponse.json({ error: 'muitas tentativas; tente novamente mais tarde' }, {
        status: 429, headers: loginTooManyResponseHeaders(blocked),
      });
    }
    return NextResponse.json({ error: 'email ou senha incorretos' }, { status: 401 });
  }
  await clearSuccessfulLogin(db, email);
  const res = NextResponse.json({ ok: true, mustChangePassword: user.mustChangePassword === 1 });
  res.cookies.set(SESSION_COOKIE, signSession(user.id, user.sessionVersion ?? 0), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 86400,
    path: '/',
  });
  return res;
}
