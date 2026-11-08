import { NextResponse } from 'next/server';
import { requireProject } from '@/lib/api-guard';
import { hydrateConnectorCredentials } from '@/lib/connector-credentials';
import { ingestSport } from '@/lib/sport';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Correzione P0 dell'audit: guard completo — demo read-only (403),
// autenticazione con versione di sessione verificata sul DB (401), progetto
// accessibile (404). In DEMO_MODE nessuna ingestione esterna.
export async function POST() {
  const guard = await requireProject({ write: true });
  if ('response' in guard) return guard.response;
  try {
    // Route API a sé stante: senza questo la chiave salvata dall'utente resta
    // invisibile a cfg() (la cache è per-processo e questa funzione serverless
    // non condivide memoria con quella che l'ha appena idratata) — il fetch
    // falliva silenziosamente (0 partite, nessun errore mostrato).
    await hydrateConnectorCredentials();
    const { tried, matches, prices } = await ingestSport(guard.project.id);
    if (tried === 0) return NextResponse.json({ error: 'no team configured yet — add one below' }, { status: 400 });
    return NextResponse.json({ matches, prices });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
