import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collectionSchedules, projects } from '@/lib/db/schema';
import { resolveTenantContext, appendAudit } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { canScheduleProject } from '@/lib/vigia/scheduler';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  const db = await getDb();
  const rows = await db.select({
    projectId: projects.id, tenantId: projects.tenantId, name: projects.name,
    mode: projects.mode, enabledSources: projects.enabledSources,
    keywords: projects.keywords, rssFeeds: projects.rssFeeds,
    enabled: collectionSchedules.enabled, updatedAt: collectionSchedules.updatedAt,
  }).from(projects).leftJoin(collectionSchedules, eq(collectionSchedules.projectId, projects.id));
  return NextResponse.json({ schedulerEnabled: process.env.VIGIA_COLLECTION_SCHEDULER === '1',
    projects: rows.map((p) => ({
      id: p.projectId, tenantId: p.tenantId, name: p.name, eligible: canScheduleProject(p),
      scheduled: p.enabled === 1, updatedAt: p.updatedAt,
    })),
  });
}

export async function POST(request: Request) {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const projectId = input.projectId;
  const enabled = input.enabled;
  if (typeof projectId !== 'number' || !Number.isSafeInteger(projectId) || projectId <= 0 ||
      typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'projectId positivo e enabled booleano são obrigatórios' }, { status: 400 });
  }
  const db = await getDb();
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return NextResponse.json({ error: 'Projeto inexistente' }, { status: 404 });
  if (enabled && !canScheduleProject(project)) {
    return NextResponse.json({ error: 'Configure fontes, palavras-chave verificáveis e RSS antes de habilitar' }, { status: 422 });
  }
  await db.insert(collectionSchedules).values({
    projectId, enabled: enabled ? 1 : 0, updatedBy: ctx.userId, updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: collectionSchedules.projectId,
    set: { enabled: enabled ? 1 : 0, updatedBy: ctx.userId, updatedAt: new Date() },
  });
  await appendAudit(ctx, { action: 'COLLECTION_SCHEDULE_CHANGED',
    target: 'project:' + projectId, reason: enabled ? 'opt-in do proprietário' : 'desativação pelo proprietário' });
  return NextResponse.json({ projectId, enabled });
}
