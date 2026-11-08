import { NextResponse } from 'next/server';
import { requireProject } from '@/lib/api-guard';
import { getClusters } from '@/lib/insights';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST() {
  // Correzione P0 dell'audit: autenticazione con verifica della versione di
  // sessione sul DB (mai dal solo middleware) e progetto accessibile.
  // DEMO_MODE: read-only, nessuna persistenza.
  const guard = await requireProject({ write: true });
  if ('response' in guard) return guard.response;
  const project = guard.project;
  const clusters = await getClusters(project.id, true);
  if (!clusters) return NextResponse.json({ error: 'dati insufficienti o tetto API raggiunto' }, { status: 400 });
  return NextResponse.json({ clusters });
}
