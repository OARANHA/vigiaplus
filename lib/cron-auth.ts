import { NextResponse } from 'next/server';
import { isDemoMode, safeSecretEqual } from '@/lib/session';

// Autenticazione delle rotte cron. Regola dell'audit (Incremento 2):
// in PRODUZIONE le rotte cron non devono MAI eseguire operazioni quando il
// segreto è assente o errato — prima la raccolta dati partiva anche senza
// CRON_SECRET configurato, e chi conosceva l'URL poteva innescare la pipeline.

export type CronAuthFailure =
  | { status: 403; reason: 'demo' }
  | { status: 500; reason: 'secret-missing' }
  | { status: 401; reason: 'secret-mismatch' };

/** Null = autorizzato. Altrimenti la risposta da restituire subito. */
export function cronAuth(req: Request): CronAuthFailure | null {
  // La demo pubblica è read-only: nessuna operazione privilegiata, cron incluso.
  if (isDemoMode()) return { status: 403, reason: 'demo' };

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      // Fail closed: meglio una pipeline ferma (visibile) che una aperta a chiunque.
      console.error('[cron] CRON_SECRET non configurato in produzione: esecuzione rifiutata (fail closed).');
      return { status: 500, reason: 'secret-missing' };
    }
    // Sviluppo locale: consentito per non pretendere un segreto sul laptop.
    return null;
  }

  const presented = req.headers.get('authorization') ?? '';
  if (!safeSecretEqual(presented, `Bearer ${secret}`)) {
    return { status: 401, reason: 'secret-mismatch' };
  }
  return null;
}

export function cronAuthResponse(failure: CronAuthFailure): NextResponse {
  if (failure.reason === 'demo') {
    return NextResponse.json({ error: 'demo mode: cron operations are disabled' }, { status: 403 });
  }
  if (failure.reason === 'secret-missing') {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured; refusing to run in production (fail closed)' },
      { status: 500 },
    );
  }
  return NextResponse.json({ error: 'non autorizzato' }, { status: 401 });
}
