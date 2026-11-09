import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { PixAdapter } from '../lib/billing/events';

const directory = mkdtempSync(join(tmpdir(), 'vigia-billing-'));
process.env.PGLITE_DIR = directory;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;
delete process.env.VIGIA_SEED_SAMPLE_TENANTS;

type Schema = typeof import('../lib/db/schema');
type Db = Awaited<ReturnType<typeof import('../lib/db')['getDb']>>;
let db: Db, schema: Schema;
let aInvoiceId: number, bInvoiceId: number, tenantAId: number, tenantBId: number;

before(async () => {
  const dbMod = await import('../lib/db');
  schema = await import('../lib/db/schema');
  db = await dbMod.getDb();
  const [tenantA, tenantB] = await db.insert(schema.tenants).values([
    { name: 'Alpha', slug: 'qa-alpha-billing' },
    { name: 'Beta', slug: 'qa-beta-billing' },
  ]).returning();
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;
  await db.insert(schema.subscriptions).values([
    { tenantId: tenantAId, planKey: 'padrao', status: 'past_due' },
    { tenantId: tenantBId, planKey: 'padrao', status: 'past_due' },
  ]);
  const [aInvoice, bInvoice] = await db.insert(schema.invoices).values([
    { tenantId: tenantAId, amountBrl: 100, gateway: 'pix', gatewayId: 'pay-alpha', status: 'processing' },
    { tenantId: tenantBId, amountBrl: 100, gateway: 'pix', gatewayId: 'pay-beta', status: 'processing' },
  ]).returning();
  aInvoiceId = aInvoice.id;
  bInvoiceId = bInvoice.id;
});
after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));

test('pagamento por charge id não cruza duas faturas do mesmo valor', async () => {
  const { processPaymentEvent } = await import('../lib/billing/process');
  const event = PixAdapter.normalize({
    id: 'evt-alpha', event: 'PAYMENT_RECEIVED',
    payment: { id: 'pay-alpha', externalReference: 'vigiaplus-invoice-1-tenant-1', value: 100 },
  });
  const applied = await processPaymentEvent(event, JSON.stringify(event));
  assert.equal(applied.applied, true);
  assert.equal(applied.tenantId, tenantAId);
  assert.equal(applied.invoiceId, aInvoiceId);
  const [a] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, aInvoiceId));
  const [b] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, bInvoiceId));
  assert.equal(a.status, 'paid');
  assert.equal(b.status, 'processing', 'a fatura de outro tenant deve permanecer intacta');
  const again = await processPaymentEvent(event, JSON.stringify(event));
  assert.equal(again.duplicate, true);
});
test('evento desconhecido ou com valor divergente jamais ativa uma assinatura', async () => {
  const { processPaymentEvent } = await import('../lib/billing/process');
  const missing = PixAdapter.normalize({
    id: 'evt-missing', event: 'PAYMENT_RECEIVED', payment: { id: 'pay-nonexistent', value: 100 },
  });
  const unmatched = await processPaymentEvent(missing, '{}');
  assert.equal(unmatched.status, 'unmatched');
  const mismatch = PixAdapter.normalize({
    id: 'evt-wrong-amount', event: 'PAYMENT_RECEIVED', payment: { id: 'pay-beta', value: 99 },
  });
  const rejected = await processPaymentEvent(mismatch, '{}');
  assert.equal(rejected.status, 'amount_mismatch');
  const [b] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, bInvoiceId));
  assert.equal(b.status, 'processing');
  const [subB] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantBId));
  assert.equal(subB.status, 'past_due');
});
test('evento posterior de falha não reverte fatura que já está paga', async () => {
  const { processPaymentEvent } = await import('../lib/billing/process');
  const lateFailure = PixAdapter.normalize({
    id: 'evt-alpha-late-failure', event: 'PAYMENT_OVERDUE', payment: { id: 'pay-alpha', value: 100 },
  });
  const ignored = await processPaymentEvent(lateFailure, '{}');
  assert.equal(ignored.status, 'ignored_already_paid');
  const [a] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, aInvoiceId));
  assert.equal(a.status, 'paid');
});
