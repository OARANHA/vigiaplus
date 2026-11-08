import { createHmac, timingSafeEqual } from 'node:crypto';
import { sessionSecretViolations, secretViolationMessage } from '@/lib/config-check';

// Cookie di sessione firmato: "<userId>.<sessionVersion>.<hmac>". Nessun
// accesso al DB qui, così può girare anche dentro il proxy (verifica solo
// la firma). La sessionVersion deriva dalla colonna users.session_version:
// cambiarla (cambio password, "esci da tutti i dispositivi") invalida OGNI
// cookie emesso prima — le sessioni diventano revocabili. La verifica
// COMPLETA (firma + versione contro il DB) vive in lib/session-auth.ts e
// in getCurrentUser: il proxy resta un pre-filtro, non un'autenticazione.

export const SESSION_COOKIE = 'sr_session';

/** Public read-only demo mode: no login, sample data, AI on-demand disabled. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

export type ParsedSession = { userId: number; version: number };

/**
 * Segreto di firma. Correzione P0 dell'audit: in produzione SESSION_SECRET è
 * OBBLIGATORIO, ESPLICITO e INDIPENDENTE da APP_PASSWORD (niente fallback:
 * la password di login non può firmare le sessioni), con lunghezza minima e
 * un minimo di entropia. Il fallback di sviluppo esiste solo fuori
 * produzione; la validazione all'avvio vive in lib/config-check.ts
 * (chiamata da instrumentation.ts).
 */
export function sessionSecret(): string {
  const explicit = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === 'production') {
    if (!explicit) {
      throw new Error(secretViolationMessage(sessionSecretViolations(undefined, process.env.APP_PASSWORD)));
    }
    const violations = sessionSecretViolations(explicit, process.env.APP_PASSWORD);
    if (violations.length > 0) {
      throw new Error(secretViolationMessage(violations));
    }
    return explicit;
  }
  if (!explicit) return 'sr-dev-secret-change-me';
  return explicit;
}

function secret(): string {
  return sessionSecret();
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export function signSession(userId: number, sessionVersion = 0): string {
  const payload = `${userId}:${sessionVersion}`;
  return `${userId}.${sessionVersion}.${sign(payload)}`;
}

/**
 * Verifica SOLO la firma (senza DB): chi usa il risultato per autenticare
 * deve confrontare la version con users.session_version (getCurrentUser lo fa).
 * I cookie nel vecchio formato "<uid>.<sig>" sono rifiutati: dopo il
 * passaggio alla firma con versione, ogni sessione precedente è revocata.
 */
export function verifySession(cookieValue: string | undefined): ParsedSession | null {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const userId = Number(parts[0]);
  const version = Number(parts[1]);
  const sig = parts[2];
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!Number.isInteger(version) || version < 0) return null;
  if (!/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = sign(`${userId}:${version}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { userId, version };
}

/** Confronto a tempo costante tra il segreto atteso e quello presentato. */
export function safeSecretEqual(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
