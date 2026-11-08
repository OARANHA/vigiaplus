import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { benchmarkEntities, projects } from '@/lib/db/schema';
import { PILOT_ENTITIES, PILOT_KEY, PILOT_NAME } from './core';

/** Provisionamento manual, repetível e isolado; nunca roda no seed global. */
export async function ensureCrfrsPilot(ownerId: number) {
  const db = await getDb();
  const [created] = await db.insert(projects).values({
    pilotKey: PILOT_KEY,
    name: PILOT_NAME,
    ownerId,
    visibility: 'private',
    mode: 'listening',
    keywords: ['CRF-RS', 'CRF/RS', 'Conselho Regional de Farmácia do Rio Grande do Sul',
      'Giovana Ranquetat Fernandes', 'giovanaranquetat', 'funcionarioscrfrs'],
    languages: ['pt'],
    countries: ['BR'],
    enabledSources: ['googlenews', 'gdelt'],
    rssFeeds: [],
    semanticContext: 'Monitoramento público de reputação e comunicação do CRF-RS, da presidente e de manifestações públicas sobre funcionários. Não inferir opiniões individuais ou clima interno.',
  }).onConflictDoNothing().returning();
  const [project] = created ? [created] :
    await db.select().from(projects).where(eq(projects.pilotKey, PILOT_KEY)).limit(1);
  if (!project) throw new Error('Não foi possível localizar o projeto piloto');
  const existing = await db.select().from(benchmarkEntities)
    .where(eq(benchmarkEntities.projectId, project.id));
  for (const def of PILOT_ENTITIES) {
    if (!existing.some((entity) => entity.name === def.name)) {
      await db.insert(benchmarkEntities).values({
        projectId: project.id, name: def.name, keywords: def.terms,
        isOwnBrand: def.key === 'crfrs' ? 1 : 0,
      });
    }
  }
  return project;
}
