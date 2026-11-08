import { NextResponse } from 'next/server';
import { cronAuth, cronAuthResponse } from '@/lib/cron-auth';
import { runPipeline } from '@/lib/pipeline';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Cron giornaliero Vercel: pipeline completa + digest Telegram del mattino.
export async function GET(req: Request) {
  // Fail closed: senza segreto valido in produzione la rotta non fa nulla.
  const authFailure = cronAuth(req);
  if (authFailure) return cronAuthResponse(authFailure);
  try {
    const result = await runPipeline({ full: true, digest: true });
    return NextResponse.json(result);
  } catch (e) {
    console.error('Cron giornaliero fallito:', e);
    return NextResponse.json({ error: String((e as Error).message) }, { status: 500 });
  }
}
