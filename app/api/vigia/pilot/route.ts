import { NextResponse } from 'next/server';
import { requireWriteUser } from '@/lib/api-guard';
import { isAdmin } from '@/lib/auth';
import { ensureCrfrsPilot } from '@/lib/vigia/pilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Operação explícita; nunca cria cliente silenciosamente no boot. */
export async function POST() {
  const auth = await requireWriteUser();
  if ('response' in auth) return auth.response;
  if (!isAdmin(auth.user)) return NextResponse.json({ error: 'Somente administrador' }, { status: 403 });
  try {
    const pilot = await ensureCrfrsPilot(auth.user.id);
    return NextResponse.json({ projectId: pilot.id, name: pilot.name, sources: pilot.enabledSources });
  } catch {
    return NextResponse.json({ error: 'Falha ao configurar o piloto' }, { status: 500 });
  }
}
