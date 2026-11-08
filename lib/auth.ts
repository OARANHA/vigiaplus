import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { SESSION_COOKIE, verifySession, isDemoMode } from '@/lib/session';
import { readViewPrefs } from '@/lib/view-prefs';

export type User = typeof users.$inferSelect;

// Synthetic viewer for the public demo: em modo demo, o usuario e o owner
// para poder acessar todas as superficies (console, portal, dashboard).
const DEMO_USER: User = {
  id: 1, name: 'Demo owner', email: 'demo@vigiaplus.app', passwordHash: '',
  role: 'admin', globalRole: 'owner', aiEnabled: 1, mustChangePassword: 0, sessionVersion: 0,
  viewDensity: 'basico', viewVocabulary: 'leigo', locale: 'pt-BR', twoFactorEnabled: 0,
  createdAt: new Date(),
};

/** Utente della sessione corrente (dal cookie firmato), o null se non loggato.
 *  La FIRMA si verifica senza DB (proxy); qui si verifica anche la VERSIONE:
 *  un cookie emesso prima di un cambio password (o di un "esci da tutti i
 *  dispositivi") ha una version più vecchia di users.session_version e muore. */
export async function getCurrentUser(): Promise<User | null> {
  let user: User;
  if (isDemoMode()) {
    user = DEMO_USER;
  } else {
    const cookieStore = await cookies();
    const session = verifySession(cookieStore.get(SESSION_COOKIE)?.value);
    if (!session) return null;
    const db = await getDb();
    const [u] = await db.select().from(users).where(eq(users.id, session.userId));
    if (!u) return null;
    if ((u.sessionVersion ?? 0) !== session.version) return null; // sessione revocata
    user = u;
  }

  // Preferencia de UI por dispositivo (cookie) sobrepoe a do cadastro.
  // So densidade/vocabulario/idioma: RBAC e tenant continuam lendo apenas da sessao.
  const prefs = await readViewPrefs();
  if (!prefs.density && !prefs.vocabulary && !prefs.locale) return user;
  return {
    ...user,
    viewDensity: prefs.density ?? user.viewDensity,
    viewVocabulary: prefs.vocabulary ?? user.viewVocabulary,
    locale: prefs.locale ?? user.locale,
  };
}

export function isAdmin(user: User | null): boolean {
  return user?.role === 'admin';
}

/** L'AI è attiva per i progetti di questo utente? (admin sempre sì) */
export function userAiEnabled(user: User | null): boolean {
  return Boolean(user && (user.role === 'admin' || user.aiEnabled === 1));
}
