import { NextResponse } from 'next/server';
import { cronAuth, cronAuthResponse } from '@/lib/cron-auth';
import { runDueEditions } from '@/lib/periodic-report';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Secondo cron: le edizioni periodiche scadute. Sta separato da quello della
// pipeline perché gira DOPO — un report deve leggere i dati del giro appena
// concluso — e perché un timeout qui non deve poter uccidere la raccolta dati,
// che è la funzione vitale dell'app.
export async function GET(req: Request) {
  // Fail closed: senza segreto valido in produzione la rotta non fa nulla.
  const authFailure = cronAuth(req);
  if (authFailure) return cronAuthResponse(authFailure);
  try {
    return NextResponse.json(await runDueEditions());
  } catch (e) {
    console.error('Cron report periodici fallito:', e);
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
