import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chooseNextClient, canScheduleProject, quarterHourSlot, runScheduledCollection } from '../lib/vigia/scheduler';

const dir = mkdtempSync(join(tmpdir(), 'vigia-scheduler-'));
process.env.PGLITE_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

type Db = typeof import('../lib/db');
type Schema = typeof import('../lib/db/schema');
let dbMod: Db, schema: Schema;
const ids: number[] = [];
const projectIds: number[] = [];

before(async () => {
  dbMod = await import('../lib/db');
  schema = await import('../lib/db/schema');
  const db = await dbMod.getDb();
  const tenants = await db.insert(schema.tenants).values(
    Array.from({ length: 4 }, (_, i) => ({
      name: 'Cliente Scheduler ' + i, slug: 'scheduler-tenant-' + i,
    })),
  ).returning();
  const projects = await db.insert(schema.projects).values(
    tenants.map((tenant, i) => ({
      tenantId: tenant.id, name: 'Coleta cliente ' + i,
      mode: 'listening', keywords: ['Assunto Cliente ' + i],
      enabledSources: ['googlenews'], languages: ['pt'], countries: ['BR'],
    })),
  ).returning();
  for (const p of projects) { ids.push(p.tenantId); projectIds.push(p.id); }
  await db.insert(schema.collectionSchedules).values(
    projects.map((p) => ({ projectId: p.id, enabled: 1 })),
  );
});
after(async () => {
  if (dbMod) {
    const db = await dbMod.getDb();
    const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
    await client?.close();
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
});

test('janelas de coleta são UTC, exatas e estáveis', () => {
  assert.equal(quarterHourSlot(new Date('2026-11-09T12:14:59Z')).toISOString(), '2026-11-09T12:00:00.000Z');
  assert.equal(quarterHourSlot(new Date('2026-11-09T12:15:00Z')).toISOString(), '2026-11-09T12:15:00.000Z');
  assert.throws(() => quarterHourSlot(new Date(NaN)), /Data/);
});
test('opt-in exige fontes verificáveis e critérios explícitos', () => {
  const base = { mode: 'listening', enabledSources: ['googlenews'],
    keywords: ['Empresa Exemplo'], rssFeeds: [] };
  assert.equal(canScheduleProject(base), true);
  assert.equal(canScheduleProject({ ...base, keywords: [] }), false);
  assert.equal(canScheduleProject({ ...base, mode: 'upload' }), false);
  assert.equal(canScheduleProject({ ...base, enabledSources: ['rss'], keywords: [],
    rssFeeds: ['https://feed.example/rss'] }), true);
  assert.equal(canScheduleProject({ ...base, enabledSources: ['rss'], rssFeeds: [] }), false);
});
test('prioriza tenant mais antigo mesmo com vários projetos', () => {
  const next = chooseNextClient([
    { projectId: 10, tenantId: 1 }, { projectId: 20, tenantId: 2 }, { projectId: 11, tenantId: 1 },
  ], [
    { projectId: 10, tenantId: 1, slotAt: new Date('2026-11-09T12:00:00Z') },
    { projectId: 20, tenantId: 2, slotAt: new Date('2026-11-09T12:15:00Z') },
  ]);
  assert.equal(next?.projectId, 11);
});
test('quatro clientes/hora, no máximo uma execução/janela e auditoria PGlite', async () => {
  const called: number[] = [];
  const fake = async (project: typeof schema.projects.$inferSelect) => {
    called.push(project.tenantId);
    return { runId: project.id, status: 'success' as const };
  };
  const start = Date.parse('2026-11-09T12:00:00Z');
  const outcomes = [];
  for (let i = 0; i < 4; i++) {
    outcomes.push(await runScheduledCollection(new Date(start + i * 900_000), fake));
  }
  assert.equal(new Set(called).size, 4);
  assert.deepEqual(new Set(called), new Set(ids));
  assert.ok(outcomes.every((row) => row.status === 'success'));
  const sameSlot = await runScheduledCollection(new Date(start + 3 * 900_000 + 30_000), fake);
  assert.equal(sameSlot.status, 'skipped');
  assert.equal(sameSlot.reason, 'janela_ja_reservada');
  assert.equal(called.length, 4);
  const fifth = await runScheduledCollection(new Date(start + 4 * 900_000), fake);
  assert.equal(fifth.status, 'success');
  assert.equal(called.length, 5);
  assert.equal(called[4], called[0]);
  const db = await dbMod.getDb();
  const rows = await db.select().from(schema.collectionScheduleSlots);
  assert.equal(rows.length, 5);
  assert.equal(rows.every((r) => r.status === 'success'), true);
  assert.deepEqual(new Set(rows.slice(0, 4).map((r) => r.tenantId)), new Set(ids));
  assert.ok(projectIds.includes(rows[0].projectId));
});
test('duas invocações concorrentes não reservam duas vezes a mesma janela', async () => {
  let calls = 0;
  const fake = async (project: typeof schema.projects.$inferSelect) => {
    calls++;
    return { runId: project.id, status: 'success' as const };
  };
  const now = new Date('2026-11-09T13:15:00Z');
  const outcomes = await Promise.all([
    runScheduledCollection(now, fake), runScheduledCollection(now, fake),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(outcomes.map((x) => x.status).sort(), ['skipped', 'success']);
});
