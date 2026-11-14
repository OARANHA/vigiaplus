import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';

process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), 'vpx-alt08-db-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

test('ALT-08: execução persistida e métricas de fila usam DDL real PGlite', async () => {
  const { getDb } = await import('../lib/db');
  const { notificationWorkerRuns, notificationDeliveries, tenants } = await import('../lib/db/schema');
  const db = await getDb();
  const [tenant] = await db.insert(tenants).values({
    name: 'ALT08 observability', slug: 'alt08-observability', status:'active',
  }).returning();
  const [row] = await db.insert(notificationWorkerRuns).values({
    runId: 'alt08-exec-0001', worker: 'notify',
    startedAt: new Date('2026-11-11T08:00:00Z'),
    finishedAt: new Date('2026-11-11T08:00:02Z'),
    status:'success', durationMs:2000, exitCode:0,
    summary:{tenants:1,entregas:{sent:0,failed:0}},
  }).returning();
  assert.equal(row.runId, 'alt08-exec-0001');
  const duplicate = await db.insert(notificationWorkerRuns).values({
    runId: row.runId, worker:'notify', startedAt: row.startedAt,
    finishedAt:row.finishedAt, status:'success',durationMs:2000,
    summary:{tenants:1},
  }).onConflictDoNothing({target:notificationWorkerRuns.runId}).returning();
  assert.equal(duplicate.length,0);
  const [stored] = await db.select().from(notificationWorkerRuns)
    .where(eq(notificationWorkerRuns.runId,row.runId));
  assert.equal(stored.summary.tenants,1);

  await db.insert(notificationDeliveries).values([
    { tenantId:tenant.id, channel:'ledger', destination:'internal',
      kind:'incident',title:'A',message:'A',dedupeKey:'alt08-a', status:'queued',
      createdAt:new Date(Date.now()-20*60_000),
      slaDueAt:new Date(Date.now()-60_000) },
    { tenantId:tenant.id, channel:'ledger', destination:'internal',
      kind:'incident',title:'B',message:'B',dedupeKey:'alt08-b', status:'dead_letter' },
  ]);
  const backlog = await db.execute(sql`
    SELECT count(*) FILTER (WHERE status='queued') AS pending,
           count(*) FILTER (WHERE status='dead_letter') AS dead_letter,
           count(*) FILTER (WHERE status='queued'
             AND created_at<now()-interval '10 minutes') AS delayed,
           count(*) FILTER (WHERE status='queued'
             AND sla_due_at < now()) AS overdue
      FROM notification_deliveries WHERE tenant_id=${tenant.id}
  `);
  assert.equal(Number(backlog.rows[0].pending),1);
  assert.equal(Number(backlog.rows[0].dead_letter),1);
  assert.equal(Number(backlog.rows[0].delayed),1);
  assert.equal(Number(backlog.rows[0].overdue),1);
});
