import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { PixAdapter, rawHash } from '../lib/billing/events';

const dir = mkdtempSync(join(tmpdir(), 'vigia-billing-atomic-'));
process.env.PGLITE_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;
type DB = Awaited<ReturnType<typeof import('../lib/db')['getDb']>>;
type Schema = typeof import('../lib/db/schema');
let db: DB, schema: Schema, tenantId: number, invoiceId: number;
let processEvent: typeof import('../lib/billing/process')['processPaymentEvent'];

before(async () => {
  db = await (await import('../lib/db')).getDb();
  schema = await import('../lib/db/schema');
  processEvent = (await import('../lib/billing/process')).processPaymentEvent;
  const [tenant] = await db.insert(schema.tenants).values({
    name: 'Pagamento Atômico', slug: 'vigia-billing-atomic-test',
  }).returning();
  tenantId = tenant.id;
  await db.insert(schema.subscriptions).values({
    tenantId, planKey: 'padrao', gateway: 'pix', status: 'past_due',
  });
  const [inv] = await db.insert(schema.invoices).values({
    tenantId, amountBrl: 123.45, gateway: 'pix', gatewayId: 'pay-atomic', status: 'processing',
  }).returning();
  invoiceId = inv.id;
});
after(async () => {
  if (db) {
    const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
    await client?.close();
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
});

function webhook(id: string, paymentId = 'pay-atomic') {
  const payload = { id, event: 'PAYMENT_RECEIVED',
    payment: { id: paymentId, value: 123.45 } };
  const raw = JSON.stringify(payload);
  return { raw, event: PixAdapter.normalize(payload) };
}

test('duas chamadas concorrentes aplicam evento uma vez e não duplicam auditoria', async () => {
  const { raw, event } = webhook('evt-atomic');
  const outcomes = await Promise.all([processEvent(event, raw), processEvent(event, raw)]);
  assert.equal(outcomes.filter((x) => x.applied).length, 1);
  assert.equal(outcomes.filter((x) => x.duplicate).length, 1);
  const evs = await db.select().from(schema.paymentEvents)
    .where(eq(schema.paymentEvents.id, 'pix:evt-atomic'));
  assert.equal(evs.length, 1);
  assert.ok(evs[0].processedAt);
  const audit = await db.select().from(schema.auditEvents)
    .where(eq(schema.auditEvents.target, 'event:pix:evt-atomic'));
  assert.equal(audit.length, 1);
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  assert.equal(invoice.status, 'paid');
  const [sub] = await db.select().from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId));
  assert.equal(sub.status, 'active');
  assert.ok(sub.vigenciaAte);
});

test('replay com mesmo id e conteúdo divergente não altera fatura nem assinatura', async () => {
  const { event } = webhook('evt-atomic');
  const result = await processEvent(event, '{"id":"evt-atomic","alterado":true}');
  assert.equal(result.status, 'event_conflict');
  assert.equal(result.applied, false);
  const rows = await db.select().from(schema.auditEvents)
    .where(eq(schema.auditEvents.target, 'event:pix:evt-atomic'));
  assert.equal(rows.length, 1);
});

test('evento legado pendente pode ser recuperado atomicamente uma única vez', async () => {
  const [inv] = await db.insert(schema.invoices).values({
    tenantId, amountBrl: 123.45, gateway: 'pix', gatewayId: 'pay-pending', status: 'processing',
  }).returning();
  const { raw, event } = webhook('evt-pending', 'pay-pending');
  await db.insert(schema.paymentEvents).values({
    id: 'pix:evt-pending', tenantId, gateway: 'pix', type: 'payment.succeeded',
    amountBrl: 123.45, rawHash: rawHash(raw),
  });
  const result = await processEvent(event, raw);
  assert.equal(result.applied, true);
  assert.equal((await processEvent(event, raw)).duplicate, true);
  const [payment] = await db.select().from(schema.paymentEvents)
    .where(eq(schema.paymentEvents.id, 'pix:evt-pending'));
  assert.ok(payment.processedAt);
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id));
  assert.equal(invoice.status, 'paid');
});

test('erro no audit_events reverte a instrução inteira (fatura e evento intactos)', async () => {
  const [inv] = await db.insert(schema.invoices).values({
    tenantId, amountBrl: 123.45, gateway: 'pix', gatewayId: 'pay-rollback', status: 'processing',
  }).returning();
  const { raw, event } = webhook('evt-rollback', 'pay-rollback');
  await db.execute(sql.raw('DROP TABLE audit_events'));
  await assert.rejects(() => processEvent(event, raw));
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv.id));
  assert.equal(invoice.status, 'processing');
  const [e] = await db.select().from(schema.paymentEvents)
    .where(eq(schema.paymentEvents.id, 'pix:evt-rollback'));
  assert.equal(e, undefined);
});
