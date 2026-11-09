import { NextResponse } from 'next/server';
import { cronAuth, cronAuthResponse } from '@/lib/cron-auth';
import { runScheduledCollection } from '@/lib/vigia/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Chamada protegida por CRON_SECRET, nunca auto-habilitada no deploy. */
export async function GET(req: Request) {
  const authFailure = cronAuth(req);
  if (authFailure) return cronAuthResponse(authFailure);
  if (process.env.VIGIA_COLLECTION_SCHEDULER !== '1') {
    return NextResponse.json({ enabled: false, status: 'disabled' }, { status: 503 });
  }
  try {
    return NextResponse.json({ enabled: true, ...await runScheduledCollection() });
  } catch (err) {
    console.error('[vigia-cron] coleta agendada falhou:', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ error: 'Falha de coleta; consultar collection_schedule_slots' }, { status: 500 });
  }
}
