import { NextResponse } from 'next/server';
import { requireProject } from '@/lib/api-guard';
import { hydrateConnectorCredentials } from '@/lib/connector-credentials';
import { ingestReviews } from '@/lib/reviews';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Correzione P0 dell'audit: guard completo — demo read-only (403),
// autenticazione con versione di sessione verificata sul DB (401), progetto
// accessibile (404). In DEMO_MODE nessuna ingestione esterna.
export async function POST() {
  const guard = await requireProject({ write: true });
  if ('response' in guard) return guard.response;
  try {
    // Vedi lo stesso fix in app/api/sport/refresh: senza idratare qui, la
    // chiave Google Places salvata dall'utente non sarebbe mai visibile a cfg().
    await hydrateConnectorCredentials();
    const { tried, fetched } = await ingestReviews(guard.project.id);
    if (tried === 0) return NextResponse.json({ error: 'no review source configured yet — add one below' }, { status: 400 });
    return NextResponse.json({ fetched });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
