import { NextResponse } from 'next/server';
import { requireProject } from '@/lib/api-guard';
import { extractTimelineEvents } from '@/lib/timeline';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Estrazione on-demand (oltre a quella del ciclo giornaliero); max 1/giorno.
// Correzione P0 dell'audit: l'estrazione PERSISTE eventi nel DB — in DEMO_MODE
// è vietata (403), e l'autenticazione passa dal guard con verifica della
// versione di sessione sul DB (mai dal solo middleware).
export async function POST() {
  const guard = await requireProject({ write: true });
  if ('response' in guard) return guard.response;
  const created = await extractTimelineEvents(guard.project.id);
  return NextResponse.json({ created });
}
