import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { planDeliveries, type RuleInput, type FactInput, type ChannelInput } from '../lib/notifications/evaluate';
import { enqueue } from '../lib/notifications/queue';

process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), 'vpx-notification-dedupe-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

const at = new Date('2026-11-10T12:00:00Z');
const rule: RuleInput = {
  id: 91, type: 'crise_aberta', active: 1, threshold: { severity: 'media' },
  channels: [], silencioDe: null, silencioAte: null, slaMinutes: 30,
};
const fact: FactInput = { kind: 'incident', id: 101, title: 'Evento comprovado', severity: 'alta' };
const channels: ChannelInput[] = [
  { channel: 'email', destination: 'um@cliente.com', active: 1, verified: 1 },
  { channel: 'email', destination: 'dois@cliente.com', active: 1, verified: 1 },
  { channel: 'telegram', destination: '123456789', active: 1, verified: 1 },
];

test('ALT-01: PGlite com 2 destinatários email + Telegram e 2 tenants, rerun e corrida', async () => {
  const { getDb } = await import('../lib/db');
  const { tenants, notificationDeliveries } = await import('../lib/db/schema');
  const db = await getDb();
  const [alfa, beta] = await db.insert(tenants).values([
    { name: 'ALT-01 Alfa', slug: 'alt-01-alfa', status: 'active' },
    { name: 'ALT-01 Beta', slug: 'alt-01-beta', status: 'active' },
  ]).returning();

  const plannedA = planDeliveries([rule], channels, fact, at, alfa.id);
  const plannedB = planDeliveries([rule], channels, fact, at, beta.id);
  assert.equal(plannedA.length, 3);
  assert.equal(plannedB.length, 3);
  // A chave de conteúdo é independente do tenant, cujo isolamento é pelo índice composto.
  assert.deepEqual(plannedA.map(i => i.dedupeKey), plannedB.map(i => i.dedupeKey));

  const attempts = await Promise.all([
    ...plannedA, ...plannedA, ...plannedA,
  ].map(item => enqueue(item)));
  assert.equal(attempts.filter(Boolean).length, 3, 'corrida não pode gravar duplicidade');
  assert.deepEqual(await Promise.all(plannedA.map(enqueue)), [false, false, false]);
  assert.deepEqual(await Promise.all(plannedB.map(enqueue)), [true, true, true]);

  const stored = await db.select().from(notificationDeliveries);
  assert.equal(stored.length, 6);
  const alfaRows = stored.filter(row => row.tenantId === alfa.id);
  const betaRows = stored.filter(row => row.tenantId === beta.id);
  assert.equal(alfaRows.length, 3);
  assert.equal(betaRows.length, 3);
  assert.deepEqual(alfaRows.map(row => row.destination).sort(),
    ['123456789', 'dois@cliente.com', 'um@cliente.com']);
  assert.ok(stored.every(row => row.status === 'queued'));
  assert.ok(stored.every(row => row.dedupeKey.startsWith('v2:')));
});

test('ALT-01: registro antigo não é regravado nem reenvia ao destinatário já atendido', async () => {
  const { getDb } = await import('../lib/db');
  const { tenants, notificationDeliveries } = await import('../lib/db/schema');
  const db = await getDb();
  const [tenant] = await db.insert(tenants).values({
    name: 'ALT-01 Legado', slug: 'alt-01-legado', status: 'active',
  }).returning();
  const legacyItems = planDeliveries([rule], channels, fact, at, tenant.id);
  await db.insert(notificationDeliveries).values({
    tenantId: tenant.id, ruleId: rule.id, channel: 'email',
    destination: ' UM@CLIENTE.COM ', kind: fact.kind, severity: 'alta',
    title: 'Já enviado', message: 'Histórico anterior preservado',
    dedupeKey: legacyItems[0].legacyDedupeKey!, status: 'sent',
    sentAt: new Date('2026-11-10T12:01:00Z'),
  });

  assert.equal(await enqueue(legacyItems[0]), false, 'não reenviar para destinatário histórico');
  assert.equal(await enqueue(legacyItems[1]), true, 'outro email ainda precisa receber');
  assert.equal(await enqueue(legacyItems[2]), true, 'outro canal ainda precisa receber');
  assert.equal(await enqueue(legacyItems[1]), false);
  const rows = await db.select().from(notificationDeliveries)
    .where(eq(notificationDeliveries.tenantId, tenant.id));
  assert.equal(rows.length, 3);
  assert.equal(rows.filter(row => row.status === 'sent').length, 1);
  assert.equal(rows.find(row => row.status === 'sent')!.message, 'Histórico anterior preservado');
  assert.equal(rows.filter(row => row.status === 'queued').length, 2);
});
