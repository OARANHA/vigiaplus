import { NextResponse } from 'next/server';
import { requireProject } from '@/lib/api-guard';
import { ingestWikiEdits } from '@/lib/wikipedia';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Correzione P0 dell'audit: guard completo — demo read-only (403),
// autenticazione con versione di sessione verificata sul DB (401), progetto
// accessibile (404). In DEMO_MODE nessuna ingestione esterna.
export async function POST() {
  const guard = await requireProject({ write: true });
  if ('response' in guard) return guard.response;
  try {
    const { tried, edits } = await ingestWikiEdits(guard.project.id);
    if (tried === 0) return NextResponse.json({ error: 'no page followed yet — add one below' }, { status: 400 });
    return NextResponse.json({ edits });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
