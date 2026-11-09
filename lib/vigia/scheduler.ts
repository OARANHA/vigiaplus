import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { collectionSchedules, collectionScheduleSlots, projects, tenants } from '@/lib/db/schema';
import { collectProject } from './collection';
import { safeSourceError, validateSourceIds } from './core';

type Project = typeof projects.$inferSelect;
type CollectResult = { runId: number; status: string };
export const QUARTER_HOUR_MS = 15 * 60_000;

export function quarterHourSlot(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error('Data de execução inválida');
  return new Date(Math.floor(now.getTime() / QUARTER_HOUR_MS) * QUARTER_HOUR_MS);
}

/** Nenhum cliente entra no agendador por seed; sempre opt-in explícito. */
export function canScheduleProject(project: Pick<Project, 'enabledSources' | 'keywords' | 'rssFeeds' | 'mode'>): boolean {
  if (project.mode !== 'listening') return false;
  const sources = validateSourceIds(project.enabledSources);
  if (!sources.length) return false;
  const hasKeywords = project.keywords.some((term) => typeof term === 'string' && term.trim().length >= 3);
  if (sources.some((source) => source !== 'rss') && !hasKeywords) return false;
  if (sources.includes('rss') && !project.rssFeeds.length) return false;
  return true;
}

type Eligible = { projectId: number; tenantId: number };
type History = { projectId: number; tenantId: number; slotAt: Date };

/** Primeiro o tenant menos recentemente atendido; dentro dele, projeto mais antigo. */
export function chooseNextClient(candidates: readonly Eligible[], history: readonly History[]): Eligible | null {
  if (!candidates.length) return null;
  const byTenant = new Map<number, number>(), byProject = new Map<number, number>();
  for (const h of history) {
    const at = h.slotAt.getTime();
    byTenant.set(h.tenantId, Math.max(byTenant.get(h.tenantId) ?? 0, at));
    byProject.set(h.projectId, Math.max(byProject.get(h.projectId) ?? 0, at));
  }
  return [...candidates].sort((a, b) =>
    (byTenant.get(a.tenantId) ?? 0) - (byTenant.get(b.tenantId) ?? 0) ||
    (byProject.get(a.projectId) ?? 0) - (byProject.get(b.projectId) ?? 0) ||
    a.projectId - b.projectId
  )[0];
}

export async function runScheduledCollection(
  now = new Date(),
  collect: (project: Project) => Promise<CollectResult> =
    (project) => collectProject(project, { trigger: 'cron' }),
): Promise<{ slotAt: string; projectId?: number; tenantId?: number; status: string; runId?: number; reason?: string }> {
  const slot = quarterHourSlot(now);
  const slotAt = slot.toISOString();
  const db = await getDb();
  const enabled = await db.select({
    projectId: projects.id, tenantId: projects.tenantId,
    mode: projects.mode, enabledSources: projects.enabledSources,
    keywords: projects.keywords, rssFeeds: projects.rssFeeds,
  }).from(collectionSchedules)
    .innerJoin(projects, eq(collectionSchedules.projectId, projects.id))
    .innerJoin(tenants, eq(projects.tenantId, tenants.id))
    .where(and(eq(collectionSchedules.enabled, 1), eq(tenants.status, 'active')));
  const candidates = enabled.filter(canScheduleProject);
  if (!candidates.length) return { slotAt, status: 'skipped', reason: 'sem_projetos_elegiveis' };

  const history = await db.select({
    projectId: collectionScheduleSlots.projectId,
    tenantId: collectionScheduleSlots.tenantId,
    slotAt: collectionScheduleSlots.slotAt,
  }).from(collectionScheduleSlots).orderBy(desc(collectionScheduleSlots.slotAt)).limit(10000);
  const selected = chooseNextClient(candidates, history);
  if (!selected) return { slotAt, status: 'skipped', reason: 'sem_projetos_elegiveis' };

  // O PK(slot_at) é a trava atômica entre pods/processos; nunca usar mutex em memória.
  const [claimed] = await db.insert(collectionScheduleSlots).values({
    slotAt: slot, projectId: selected.projectId, tenantId: selected.tenantId,
    status: 'running', startedAt: now,
  }).onConflictDoNothing().returning({ slotAt: collectionScheduleSlots.slotAt });
  if (!claimed) return { slotAt, status: 'skipped', reason: 'janela_ja_reservada' };

  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, selected.projectId)).limit(1);
    if (!project) throw new Error('Projeto agendado indisponível');
    const result = await collect(project);
    await db.update(collectionScheduleSlots).set({
      status: result.status, runId: result.runId, finishedAt: new Date(),
    }).where(eq(collectionScheduleSlots.slotAt, slot));
    return { slotAt, projectId: project.id, tenantId: selected.tenantId,
      status: result.status, runId: result.runId };
  } catch (err) {
    await db.update(collectionScheduleSlots).set({
      status: 'failed', error: safeSourceError(err).message, finishedAt: new Date(),
    }).where(eq(collectionScheduleSlots.slotAt, slot));
    throw err;
  }
}
