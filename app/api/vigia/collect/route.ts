import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireWriteUser } from '@/lib/api-guard';
import { isAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { collectProject, CollectionAlreadyRunning } from '@/lib/vigia/collection';
import { PILOT_KEY } from '@/lib/vigia/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Sempre exige projectId explícito; nunca usa projeto do cookie como fallback. */
export async function POST(request: Request) {
  const auth = await requireWriteUser();
  if ('response' in auth) return auth.response;
  const body = await request.json().catch(() => null) as { projectId?: unknown } | null;
  const projectId = body?.projectId;
  if (typeof projectId !== 'number' || !Number.isSafeInteger(projectId) || projectId <= 0) {
    return NextResponse.json({ error: 'projectId positivo e explícito é obrigatório' }, { status: 400 });
  }
  const db = await getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || project.pilotKey !== PILOT_KEY ||
      (!isAdmin(auth.user) && project.ownerId !== auth.user.id)) {
    return NextResponse.json({ error: 'Projeto não encontrado ou acesso negado' }, { status: 404 });
  }
  try {
    const result = await collectProject(project);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CollectionAlreadyRunning) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Não foi possível executar a coleta; consulte o histórico da execução' },
      { status: 500 });
  }
}
