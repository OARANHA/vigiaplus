import { NextResponse } from 'next/server';
import { requireProject } from '@/lib/api-guard';
import { hydrateConnectorCredentials } from '@/lib/connector-credentials';
import { factCheckEnabled, ingestFactChecks } from '@/lib/factcheck';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// Correzione P0 dell'audit: guard completo — demo read-only (403),
// autenticazione con versione di sessione verificata sul DB (401), progetto
// accessibile (404). In DEMO_MODE nessuna ingestione esterna.
export async function POST() {
  const guard = await requireProject({ write: true });
  if ('response' in guard) return guard.response;
  try {
    await hydrateConnectorCredentials();
    if (!factCheckEnabled()) return NextResponse.json({ error: 'manca la chiave Google Fact Check — inseriscila qui sotto' }, { status: 400 });
    const r = await ingestFactChecks(guard.project.id);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
