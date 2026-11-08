import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin, type User } from '@/lib/auth';
import { getCurrentProject } from '@/lib/data';
import { isDemoMode } from '@/lib/session';
import type { projects } from '@/lib/db/schema';

// Guardie di rotta per OGNI endpoint protetto (correzione P0 dell'audit).
// Il proxy valida solo la firma del cookie (lì PGlite non è raggiungibile):
// l'autenticazione vera — firma + versione della sessione nel DB + esistenza
// dell'utente — avviene qui, dentro ogni rotta. Nessun endpoint mutabile può
// più "dipendere dal solo middleware".
//
// Regola dell'audit sul REFRESH: l'assenza di un progetto accessibile NON si
// trasforma MAI in operazione globale. requireProject() risponde 404 e la
// rotta muore lì: runPipeline riceve projectId solo se esiste un progetto
// effettivamente accessibile all'utente.

export type Project = typeof projects.$inferSelect;

/** Esito di una guardia: `{ user, project }` se autorizzata, altrimenti la risposta da restituire. */
export type Guarded =
  | { user: User; project: Project }
  | { response: NextResponse };

function json401(): NextResponse {
  return NextResponse.json({ error: 'non autorizzato' }, { status: 401 });
}

function json403Demo(): NextResponse {
  return NextResponse.json({ error: 'demo mode: read-only' }, { status: 403 });
}

/**
 * Contesto completo di una rotta operativa: utente autenticato (firma +
 * versione della sessione verificate sul DB) E progetto accessibile.
 * - `write: true` → la demo pubblica risponde 403 (nessuna persistenza,
 *   nessuna ingestione esterna in DEMO_MODE).
 * - Nessun progetto accessibile → 404 esplicito. MAI un fallback globale.
 */
export async function requireProject(opts: { write?: boolean } = {}): Promise<Guarded> {
  if (opts.write && isDemoMode()) return { response: json403Demo() };
  const user = await getCurrentUser();
  if (!user) return { response: json401() };
  const project = await getCurrentProject();
  if (!project) {
    return {
      response: NextResponse.json(
        { error: 'nessun progetto accessibile' },
        { status: 404 },
      ),
    };
  }
  return { user, project };
}

/** Utente autenticato per un'operazione di SOLA LETTURA (demo: utente sintetico). */
export async function requireUser(): Promise<{ user: User } | { response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) return { response: json401() };
  return { user };
}

/**
 * Utente autenticato per un'operazione di SCRITTURA. In DEMO_MODE la risposta
 * è 403: la demo pubblica è read-only (nessuna persistenza, nessuna
 * ingestione, nessuna operazione amministrativa).
 */
export async function requireWriteUser(): Promise<{ user: User } | { response: NextResponse }> {
  if (isDemoMode()) return { response: json403Demo() };
  return requireUser();
}

/** Come requireProject, ma l'operazione è riservata agli amministratori. */
export async function requireAdminProject(opts: { write?: boolean } = {}): Promise<Guarded> {
  if (opts.write && isDemoMode()) return { response: json403Demo() };
  const user = await getCurrentUser();
  if (!user) return { response: json401() };
  if (!isAdmin(user)) {
    return { response: NextResponse.json({ error: 'solo amministratori' }, { status: 403 }) };
  }
  const project = await getCurrentProject();
  if (!project) {
    return {
      response: NextResponse.json(
        { error: 'nessun progetto accessibile' },
        { status: 404 },
      ),
    };
  }
  return { user, project };
}
