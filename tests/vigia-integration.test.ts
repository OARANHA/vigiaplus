import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { RawMention } from '../lib/connectors/types';

const dir = mkdtempSync(join(tmpdir(), 'vigia-crfrs-int-'));
process.env.PGLITE_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

type Db = typeof import('../lib/db');
type Schema = typeof import('../lib/db/schema');
type Pilot = typeof import('../lib/vigia/pilot');
type Collector = typeof import('../lib/vigia/collection');
type Google = typeof import('../lib/connectors/googlenews');
type Gdelt = typeof import('../lib/connectors/gdelt');

let dbMod: Db, schema: Schema, pilot: Pilot, collector: Collector;
let google: Google, gdelt: Gdelt;
let originalGoogle: Google['googleNews']['fetchMentions'];
let originalGdelt: Gdelt['gdelt']['fetchMentions'];
let project: Awaited<ReturnType<Pilot['ensureCrfrsPilot']>>;

function raw(source: string, id: string, title: string, url: string): RawMention {
  return {
    source, externalId: id, url, title, content: title,
    publishedAt: new Date(), language: 'pt',
  };
}

before(async () => {
  dbMod = await import('../lib/db');
  schema = await import('../lib/db/schema');
  pilot = await import('../lib/vigia/pilot');
  collector = await import('../lib/vigia/collection');
  google = await import('../lib/connectors/googlenews');
  gdelt = await import('../lib/connectors/gdelt');
  originalGoogle = google.googleNews.fetchMentions;
  originalGdelt = gdelt.gdelt.fetchMentions;
  await dbMod.getDb();
  project = await pilot.ensureCrfrsPilot(1);
});

after(async () => {
  if (google) google.googleNews.fetchMentions = originalGoogle;
  if (gdelt) gdelt.gdelt.fetchMentions = originalGdelt;
  const db = await dbMod.getDb();
  const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
  assert.ok(client, 'PGlite deve expor cliente para reabertura da base de teste');
  await client.close();
  // Abrir a mesma base PGlite após fechar a conexão prova que o histórico está no disco.
  const { PGlite } = await import('@electric-sql/pglite');
  const reopened = new PGlite(dir);
  const stored = await reopened.query<{ count: string }>('SELECT count(*)::text AS count FROM collection_runs');
  assert.ok(Number(stored.rows[0].count) >= 4, 'histórico deve sobreviver ao reinício');
  await reopened.close();
  rmSync(dir, { recursive: true, force: true });
});

test('provisionamento idempotente: um projeto e exatamente três entidades', async () => {
  const second = await pilot.ensureCrfrsPilot(1);
  assert.equal(project.id, second.id);
  const db = await dbMod.getDb();
  const entities = await db.select().from(schema.benchmarkEntities)
    .where(eq(schema.benchmarkEntities.projectId, project.id));
  assert.deepEqual(entities.map((x) => x.name).sort(), [
    'CRF-RS', 'Funcionários CRF-RS', 'Giovana Ranquetat Fernandes',
  ].sort());
  assert.deepEqual(second.enabledSources, ['googlenews', 'gdelt']);
  assert.deepEqual(second.rssFeeds, []);
});

test('primeira coleta persiste artigo, entidades, duas descobertas e execuções por fonte', async () => {
  google.googleNews.fetchMentions = async (q) =>
    q.anyTerms.some((t) => t.includes('Giovana Ranquetat'))
      ? [raw('googlenews', 'news-google-1', 'Giovana Ranquetat Fernandes no CRF-RS',
        'https://jornal.example/p1?utm_source=google')]
      : [];
  gdelt.gdelt.fetchMentions = async () => [
    raw('gdelt', 'news-gdelt-1', 'Giovana Ranquetat Fernandes no CRF-RS',
      'https://jornal.example/p1'),
  ];
  const first = await collector.collectProject(project);
  assert.equal(first.status, 'success');
  assert.equal(first.rawCount, 2);
  assert.equal(first.newCount, 1);
  assert.equal(first.duplicateCount, 1);
  const db = await dbMod.getDb();
  const saved = await db.select().from(schema.mentions)
    .where(eq(schema.mentions.projectId, project.id));
  assert.equal(saved.length, 1);
  const linked = await db.select().from(schema.mentionEntities)
    .where(eq(schema.mentionEntities.mentionId, saved[0].id));
  assert.equal(linked.length, 2);
  const provenance = await db.select().from(schema.mentionDiscoveries)
    .where(eq(schema.mentionDiscoveries.runId, first.runId));
  assert.equal(provenance.length, 2);
  assert.deepEqual(provenance.map((x) => x.source).sort(), ['gdelt', 'googlenews']);
  const sourceRows = await db.select().from(schema.collectionRunSources)
    .where(eq(schema.collectionRunSources.runId, first.runId));
  assert.equal(sourceRows.length, 2);
  assert.equal(sourceRows.every((x) => x.status === 'success'), true);
});

test('segunda coleta retorna zero novas menções e mantém trilha de descobertas', async () => {
  const run = await collector.collectProject(project);
  assert.equal(run.newCount, 0);
  assert.equal(run.duplicateCount, 2);
  const db = await dbMod.getDb();
  const count = await db.select().from(schema.mentions)
    .where(eq(schema.mentions.projectId, project.id));
  assert.equal(count.length, 1);
});

test('fonte vazia é sucesso; HTTP 429 de outra fonte produz execução parcial', async () => {
  google.googleNews.fetchMentions = async () => [];
  gdelt.gdelt.fetchMentions = async () => { throw new Error('HTTP 429 em https://api.example.com/?token=sensitive'); };
  const result = await collector.collectProject(project);
  assert.equal(result.status, 'partial');
  assert.equal(result.rawCount, 0);
  const db = await dbMod.getDb();
  const states = await db.select().from(schema.collectionRunSources)
    .where(eq(schema.collectionRunSources.runId, result.runId));
  assert.equal(states.find((x) => x.source === 'googlenews')?.status, 'success');
  const error = states.find((x) => x.source === 'gdelt');
  assert.equal(error?.status, 'failed');
  assert.equal(error?.httpStatus, 429);
  assert.ok(!error?.error?.includes('sensitive'));
});

test('coleta concorrente do mesmo projeto é recusada pelo índice único', async () => {
  const db = await dbMod.getDb();
  const [active] = await db.insert(schema.collectionRuns)
    .values({ projectId: project.id, status: 'running', trigger: 'manual' }).returning();
  await assert.rejects(() => collector.collectProject(project), collector.CollectionAlreadyRunning);
  await db.update(schema.collectionRuns).set({ status: 'failed', finishedAt: new Date() })
    .where(eq(schema.collectionRuns.id, active.id));
});

test('segundo projeto não altera nem consulta o estado do CRF-RS', async () => {
  const db = await dbMod.getDb();
  const [other] = await db.insert(schema.projects).values({
    name: 'Outro cliente isolado', ownerId: 1, languages: ['pt'], countries: ['BR'],
    enabledSources: ['gdelt'], keywords: ['CRF-RS'],
  }).returning();
  const previous = await db.select().from(schema.collectionRuns)
    .where(eq(schema.collectionRuns.projectId, project.id));
  gdelt.gdelt.fetchMentions = async () => [];
  const result = await collector.collectProject(other);
  assert.equal(result.projectId, other.id);
  assert.equal(result.status, 'success');
  assert.equal(result.newCount, 0);
  const now = await db.select().from(schema.collectionRuns)
    .where(eq(schema.collectionRuns.projectId, project.id));
  assert.equal(now.length, previous.length);
  const inOther = await db.select().from(schema.collectionRunSources)
    .where(and(eq(schema.collectionRunSources.projectId, other.id),
      eq(schema.collectionRunSources.runId, result.runId)));
  assert.equal(inOther.length, 1);
  assert.equal(inOther[0].source, 'gdelt');
});
