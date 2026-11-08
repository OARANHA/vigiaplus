import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { verifySession } from '@/lib/session';

// Verifica della sessione CONNESSIONE AL DB — il cuore della correzione P0
// dell'audit. Il proxy (middleware) firma-soltanto resta un pre-filtro
// veloce: lì non si può aprire PGlite. Qui invece si controlla TUTTO:
//   1. firma HMAC del cookie (verifySession, senza DB)
//   2. esistenza dell'utente nel database
//   3. VERSIONE della sessione: un cookie emesso prima di un cambio password
//      o di un "esci da tutti i dispositivi" ha una versione più vecchia di
//      users.session_version e muore, ANCHE con firma perfettamente valida.
// Nessuna rotta può dipendere dal solo middleware: questo modulo (o
// getCurrentUser, che implementa la stessa regola) è l'unica autenticazione
// che conta.
//
// Nessun import di next/headers: gira anche nei test di integrazione con un
// PGlite usa-e-getta.

export type SessionUser = typeof users.$inferSelect;

export type AuthFailureReason =
  | 'no-cookie'        // cookie assente
  | 'bad-signature'    // firma assente/manomessa ( sarebbe già morto nel proxy)
  | 'unknown-user'     // utente cancellato
  | 'revoked';         // firma valida ma versione superata — il caso P0

export type AuthOutcome =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401; reason: AuthFailureReason };

/** Autentica un cookie di sessione contro il database (firma + versione). */
export async function authenticateSession(
  db: DB,
  cookieValue: string | undefined,
): Promise<AuthOutcome> {
  const session = verifySession(cookieValue);
  if (!session) {
    return { ok: false, status: 401, reason: cookieValue ? 'bad-signature' : 'no-cookie' };
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId));
  if (!user) return { ok: false, status: 401, reason: 'unknown-user' };
  if ((user.sessionVersion ?? 0) !== session.version) {
    // Firma HMAC valida ma sessione REVOCATA: è esattamente il buco che
    // l'audit ha chiuso — la firma non basta, conta la versione nel DB.
    return { ok: false, status: 401, reason: 'revoked' };
  }
  return { ok: true, user };
}

/** Incrementa users.session_version: revoca OGNI cookie emesso finora. */
export async function bumpSessionVersion(db: DB, userId: number): Promise<number> {
  const [bumped] = await db.update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId))
    .returning({ sessionVersion: users.sessionVersion });
  return bumped?.sessionVersion ?? 0;
}

export type RevokeAllOutcome =
  | { ok: true; newVersion: number }
  | { ok: false; status: 401; reason: AuthFailureReason };

/**
 * "Esci da tutti i dispositivi" (POST /api/auth {revokeAll}).
 * Regola dell'audit: NON può partire da un cookie la cui sessione è GIÀ
 * stata revocata — la versione nel database si verifica PRIMA del bump,
 * non dopo. Una sessione revogata non revoca (e non tocca) niente.
 */
export async function revokeAllSessions(
  db: DB,
  cookieValue: string | undefined,
): Promise<RevokeAllOutcome> {
  const auth = await authenticateSession(db, cookieValue);
  if (!auth.ok) return { ok: false, status: auth.status, reason: auth.reason };
  const newVersion = await bumpSessionVersion(db, auth.user.id);
  return { ok: true, newVersion };
}
