import { NextResponse } from 'next/server';
import { requireProject } from '@/lib/api-guard';
import { ingestTrials } from '@/lib/trials';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

// Correzione P0 dell'audit: guard completo — demo read-only (403),
// autenticazione con versione di sessione verificata sul DB (401), progetto
// accessibile (404). In DEMO_MODE nessuna ingestione esterna.
export async function POST() {
  const guard = await requireProject({ write: true });
  if ('response' in guard) return guard.response;
  try {
    const r = await ingestTrials(guard.project.id);
    if (r.tried === 0) return NextResponse.json({ error: 'scegli prima che cosa seguire (farmaci, condizioni, sponsor)' }, { status: 400 });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
