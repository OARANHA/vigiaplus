import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { RawMention } from '../lib/connectors/types';

const dir = mkdtempSync(join(tmpdir(), 'vigia-tenant-listening-'));
process.env.PGLITE_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

type DbMod = typeof import('../lib/db');
type Schema = typeof import('../lib/db/schema');
type Collector = typeof import('../lib/vigia/collection');
type Google = typeof import('../lib/connectors/googlenews');
let dbMod: DbMod, schema: Schema, collector: Collector, google: Google;
let initial: Google['googleNews']['fetchMentions'];
let projectA: typeof schema.projects.$inferSelect, projectB: typeof schema.projects.$inferSelect;
const calls: string[][] = [];

function item(title: string, id: string): RawMention {
  return {
    source: 'googlenews', externalId: id, url: 'https://jornal.example/' + id,
    title, content: title, publishedAt: new Date(), language: 'pt',
  };
}

before(async () => {
  dbMod = await import('../lib/db');
  schema = await import('../lib/db/schema');
  collector = await import('../lib/vigia/collection');
  google = await import('../lib/connectors/googlenews');
  initial = google.googleNews.fetchMentions;
  const db = await dbMod.getDb();
  const [a, b] = await db.insert(schema.tenants).values([
    { name: 'Cliente Alfa', slug: 'vigia-alfa-integration' },
    { name: 'Cliente Beta', slug: 'vigia-beta-integration' },
  ]).returning();
  [projectA, projectB] = await db.insert(schema.projects).values([
    { name: 'Projeto A', tenantId: a.id, mode: 'listening',
      keywords: ['Órbita Alfa'], enabledSources: ['googlenews'], languages: ['pt'], countries: ['BR'] },
    { name: 'Projeto B', tenantId: b.id, mode: 'listening',
      keywords: ['Beta Fluxo'], enabledSources: ['googlenews'], languages: ['pt'], countries: ['BR'] },
  ]).returning();
  await db.insert(schema.benchmarkEntities).values([
    { projectId: projectA.id, name: 'Órbita Alfa', keywords: ['Órbita Alfa'] },
    { projectId: projectB.id, name: 'Beta Fluxo', keywords: ['Beta Fluxo'] },
  ]);
  google.googleNews.fetchMentions = async (q) => {
    calls.push(q.anyTerms);
    if (q.anyTerms.some((x) => x.includes('Órbita Alfa'))) {
      return [item('Comunicado da Órbita Alfa', 'same-external-id')];
    }
    if (q.anyTerms.some((x) => x.includes('Beta Fluxo'))) {
      return [item('Comunicado da Beta Fluxo', 'same-external-id')];
    }
    throw new Error('Query sem termos do tenant');
  };
});

after(async () => {
  if (google) google.googleNews.fetchMentions = initial;
  if (dbMod) {
    const db = await dbMod.getDb();
    const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
    await client?.close();
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
});

test('dois tenants geram queries próprias sem contaminação de palavras-chave ou entidade', async () => {
  const first = await collector.collectProject(projectA, { trigger: 'cron' });
  const second = await collector.collectProject(projectB, { trigger: 'cron' });
  assert.equal(first.status, 'success');
  assert.equal(second.status, 'success');
  assert.equal(first.newCount, 1);
  assert.equal(second.newCount, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].some((x) => x.includes('Órbita Alfa')));
  assert.ok(!calls[0].some((x) => x.includes('Beta Fluxo')));
  assert.ok(calls[1].some((x) => x.includes('Beta Fluxo')));
  assert.ok(!calls[1].some((x) => x.includes('Órbita Alfa')));
  const db = await dbMod.getDb();
  const aMentions = await db.select().from(schema.mentions).where(eq(schema.mentions.projectId, projectA.id));
  const bMentions = await db.select().from(schema.mentions).where(eq(schema.mentions.projectId, projectB.id));
  assert.equal(aMentions.length, 1);
  assert.equal(bMentions.length, 1);
  assert.match(aMentions[0].title ?? '', /Alfa/);
  assert.match(bMentions[0].title ?? '', /Beta/);
  assert.equal(aMentions[0].externalId, bMentions[0].externalId, 'IDs externos iguais permanecem isolados por projeto');
  const allLinks = await db.select().from(schema.mentionEntities);
  const linksA = allLinks.filter((x) => x.projectId === projectA.id);
  const linksB = allLinks.filter((x) => x.projectId === projectB.id);
  assert.equal(linksA.length, 1);
  assert.equal(linksB.length, 1);
  assert.notEqual(linksA[0].entityId, linksB[0].entityId);
  assert.notEqual(linksA[0].mentionId, linksB[0].mentionId);
  const runs = await db.select().from(schema.collectionRuns);
  assert.ok(runs.some((x) => x.projectId === projectA.id && x.trigger === 'cron'));
  assert.ok(runs.some((x) => x.projectId === projectB.id && x.trigger === 'cron'));
});
