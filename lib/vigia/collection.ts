import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  benchmarkEntities, collectionRuns, collectionRunSources, mentionDiscoveries,
  mentionEntities, mentions, projects,
} from '@/lib/db/schema';
import { googleNews } from '@/lib/connectors/googlenews';
import { gdelt } from '@/lib/connectors/gdelt';
import { rss } from '@/lib/connectors/rss';
import { booleanQuery, type ListeningQuery, type RawMention } from '@/lib/connectors/types';
import { canonicalArticleUrl, classifyEntities, discardReason, PILOT_ENTITIES,
  safeSourceError, validateSourceIds, type PilotSource } from './core';

type Project = typeof projects.$inferSelect;
export class CollectionAlreadyRunning extends Error {
  constructor() { super('Já existe uma coleta em execução para este projeto'); }
}

const ENDPOINTS: Record<PilotSource, string> = {
  googlenews: 'https://news.google.com/rss/search',
  gdelt: 'https://api.gdeltproject.org/api/v2/doc/doc',
  rss: 'feed(s) do projeto',
};

type SourceJob = { query: string; fetch: () => Promise<RawMention[]> };

function sourceJobs(source: PilotSource, project: Project): SourceJob[] {
  const base: ListeningQuery = {
    anyTerms: [], allTerms: [], excludeTerms: [], languages: ['pt'], countries: ['BR'],
    rssFeeds: project.rssFeeds ?? [], strict: true,
  };
  if (source === 'rss') {
    // Um feed inexistente ou não validado NÃO é substituído por um URL fictício.
    return project.rssFeeds.length === 0 ? [] : [{
      query: project.rssFeeds.join(' | '), fetch: () => rss.fetchMentions(base),
    }];
  }
  if (source === 'gdelt') {
    // Uma consulta GDELT por execução respeita o limite conhecido de taxa.
    const query = { ...base, anyTerms: ['CRF-RS', 'CRF/RS',
      'Conselho Regional de Farmácia do Rio Grande do Sul',
      'Giovana Ranquetat Fernandes', 'giovanaranquetat', 'funcionarioscrfrs'] };
    return [{ query: booleanQuery(query) + ' sourcecountry:BR (timespan=3d)',
      fetch: () => gdelt.fetchMentions(query) }];
  }
  return PILOT_ENTITIES.map((entity) => {
    const query = { ...base, anyTerms: entity.terms.slice(0, 2) };
    return { query: booleanQuery(query) + ' when:90d (BR/pt-BR)',
      fetch: () => googleNews.fetchMentions(query) };
  });
}

function uniqueExternal(items: RawMention[]): { unique: RawMention[]; repeats: number } {
  const found = new Map<string, RawMention>();
  for (const m of items) {
    const key = m.source + ':' + m.externalId;
    if (!found.has(key)) found.set(key, m);
  }
  return { unique: [...found.values()], repeats: items.length - found.size };
}

/** Coleta manual sem pipeline de IA, relatórios, notificações ou descarte. */
export async function collectProject(project: Project) {
  const sources = validateSourceIds(project.enabledSources);
  if (sources.length === 0) throw new Error('Projeto sem fontes habilitadas');
  if (sources.includes('rss') && !project.rssFeeds.length) {
    throw new Error('RSS ativado sem feed real previamente validado');
  }
  const db = await getDb();
  // Recuperação auditável de execução interrompida; não desbloqueia coleta recente.
  const staleBefore = new Date(Date.now() - 15 * 60_000);
  const stuck = await db.select().from(collectionRuns)
    .where(and(eq(collectionRuns.projectId, project.id), eq(collectionRuns.status, 'running')));
  for (const run of stuck) {
    if (run.startedAt < staleBefore) {
      await db.update(collectionRuns)
        .set({ status: 'failed', finishedAt: new Date(), error: 'Execução interrompida (tempo máximo de recuperação)' })
        .where(and(eq(collectionRuns.id, run.id), eq(collectionRuns.status, 'running')));
    }
  }
  const [run] = await db.insert(collectionRuns)
    .values({ projectId: project.id, trigger: 'manual', status: 'running' })
    .onConflictDoNothing().returning();
  if (!run) throw new CollectionAlreadyRunning();

  const entityRows = await db.select().from(benchmarkEntities)
    .where(eq(benchmarkEntities.projectId, project.id));
  const entityIdByName = new Map(entityRows.map((e) => [e.name, e.id]));
  let rawCount = 0, acceptedCount = 0, newCount = 0, duplicateCount = 0, discardedCount = 0;
  let success = 0, failed = 0;
  try {
    // Fontes sequenciais: quota, timeout e histórico por tentativa.
    for (const source of sources) {
      const jobs = sourceJobs(source, project);
      const started = new Date();
      const [prior] = await db.select().from(collectionRunSources)
        .where(and(eq(collectionRunSources.projectId, project.id),
          eq(collectionRunSources.source, source), eq(collectionRunSources.status, 'success')))
        .orderBy(desc(collectionRunSources.finishedAt)).limit(1);
      const [attempt] = await db.insert(collectionRunSources).values({
        runId: run.id, projectId: project.id, source,
        originUrl: ENDPOINTS[source], query: jobs.map((j) => j.query).join('\n'),
        status: 'running', startedAt: started,
        lastSuccessAt: prior?.lastSuccessAt ?? prior?.finishedAt ?? null,
      }).returning();
      let raw = 0, accepted = 0, newly = 0, duplicates = 0, discarded = 0;
      const reasons: Record<string, number> = {};
      let outcome: 'success' | 'failed' = 'success';
      let error: string | null = null;
      let httpStatus: number | null = null;
      try {
        if (jobs.length === 0) throw new Error('Nenhum feed RSS real configurado');
        const all: RawMention[] = [];
        for (const job of jobs) {
          const found = await job.fetch();
          raw += found.length;
          all.push(...found);
        }
        const unique = uniqueExternal(all);
        duplicates += unique.repeats;
        for (const m of unique.unique) {
          const reason = discardReason(m);
          if (reason) {
            discarded++;
            reasons[reason] = (reasons[reason] ?? 0) + 1;
            continue;
          }
          accepted++;
          const key = canonicalArticleUrl(m.url)!;
          const [exact] = await db.select({ id: mentions.id }).from(mentions)
            .where(and(eq(mentions.projectId, project.id), eq(mentions.source, m.source),
              eq(mentions.externalId, m.externalId.slice(0, 500)))).limit(1);
          const [canonical] = exact ? [exact] : await db.select({ id: mentions.id }).from(mentions)
            .where(and(eq(mentions.projectId, project.id), eq(mentions.canonicalKey, key))).limit(1);
          let mentionId = exact?.id ?? canonical?.id;
          const duplicate = Boolean(mentionId);
          if (!mentionId) {
            const [inserted] = await db.insert(mentions).values({
              projectId: project.id, source: m.source, externalId: m.externalId.slice(0, 500),
              canonicalKey: key, url: m.url, title: m.title, content: m.content,
              kind: 'article', author: m.author, community: m.community,
              publishedAt: m.publishedAt, language: m.language,
              country: m.country?.toLowerCase() === 'brazil' ? 'br' : m.country?.toLowerCase(),
            }).onConflictDoNothing().returning({ id: mentions.id });
            mentionId = inserted?.id;
            if (!mentionId) {
              const [again] = await db.select({ id: mentions.id }).from(mentions)
                .where(and(eq(mentions.projectId, project.id), eq(mentions.source, m.source),
                  eq(mentions.externalId, m.externalId.slice(0, 500)))).limit(1);
              mentionId = again?.id;
            }
            if (inserted) newly++;
            else duplicates++;
          } else {
            duplicates++;
          }
          if (!mentionId) throw new Error('Menção não persistida');
          // Descoberta separada permite auditar dois índices que apontam ao mesmo artigo.
          await db.insert(mentionDiscoveries).values({
            runId: run.id, projectId: project.id, mentionId,
            source, externalId: m.externalId.slice(0, 500), url: m.url,
            duplicate: duplicate ? 1 : 0,
          }).onConflictDoNothing();
          for (const key of classifyEntities(m)) {
            const entity = PILOT_ENTITIES.find((item) => item.key === key);
            const entityId = entity && entityIdByName.get(entity.name);
            if (entityId) {
              await db.insert(mentionEntities).values({
                projectId: project.id, mentionId, entityId,
              }).onConflictDoNothing();
            }
          }
        }
      } catch (e) {
        outcome = 'failed';
        const safe = safeSourceError(e);
        error = safe.message;
        httpStatus = safe.httpStatus;
      }
      const finishedAt = new Date();
      await db.update(collectionRunSources).set({
        status: outcome, finishedAt, rawCount: raw, acceptedCount: accepted,
        newCount: newly, duplicateCount: duplicates, discardedCount: discarded,
        discardReasons: reasons, error, httpStatus,
        durationMs: finishedAt.getTime() - started.getTime(),
        lastSuccessAt: outcome === 'success' ? finishedAt :
          prior?.lastSuccessAt ?? prior?.finishedAt ?? null,
      }).where(eq(collectionRunSources.id, attempt.id));
      rawCount += raw;
      acceptedCount += accepted;
      newCount += newly;
      duplicateCount += duplicates;
      discardedCount += discarded;
      if (outcome === 'success') success++;
      else failed++;
    }
    const status = failed === 0 ? 'success' : success > 0 ? 'partial' : 'failed';
    await db.update(collectionRuns).set({
      status, finishedAt: new Date(), rawCount, acceptedCount,
      newCount, duplicateCount, discardedCount,
      error: failed ? String(failed) + ' fonte(s) falharam' : null,
    }).where(eq(collectionRuns.id, run.id));
    return { runId: run.id, projectId: project.id, status,
      rawCount, acceptedCount, newCount, duplicateCount, discardedCount };
  } catch (e) {
    await db.update(collectionRuns).set({
      status: 'failed', finishedAt: new Date(), rawCount, acceptedCount,
      newCount, duplicateCount, discardedCount, error: safeSourceError(e).message,
    }).where(eq(collectionRuns.id, run.id));
    throw e;
  }
}
