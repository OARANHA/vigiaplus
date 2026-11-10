import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import {
  commercialConstraintReport, ensureCommercialConstraints,
} from '../lib/db/commercial-constraints';
import {
  activateManualContractAtomic, setFeatureOverrideAtomic,
} from '../lib/db/commercial-writes';

async function fixture() {
  const client = new PGlite();
  await client.exec(`
    CREATE TABLE tenants (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      plan_key TEXT NOT NULL DEFAULT 'trial'
    );
    CREATE TABLE plans (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL
    );
    CREATE TABLE subscriptions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      plan_key TEXT NOT NULL,
      gateway TEXT NOT NULL DEFAULT 'manual',
      gateway_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      vigencia_ate TIMESTAMPTZ,
      grace_until TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE tenant_features (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      feature_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      expires_at TIMESTAMPTZ,
      updated_by INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE audit_events (
      id SERIAL PRIMARY KEY,
      actor TEXT,
      tenant_id INTEGER,
      action TEXT NOT NULL,
      target TEXT,
      reason TEXT,
      ip TEXT,
      meta JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO tenants (id,name,slug,status) VALUES (1,'Empresa Alfa','alfa','pending');
    INSERT INTO plans (key,label) VALUES ('padrao','Padrão'),('empresa','Empresa');
  `);
  const db = drizzle(client, { schema });
  return { client, db };
}
const actor = {userId:99, name:'Operador QA', ip:null};

test('migração aditiva: índices únicos e relatórios prontos sem duplicidades', async () => {
  const {client, db} = await fixture();
  try {
    const status = await ensureCommercialConstraints(db);
    assert.equal(status.featureIndex, true);
    assert.equal(status.subscriptionIndex, true);
    assert.equal(status.duplicateFeatures.length, 0);
    assert.equal(status.duplicateSubscriptions.length, 0);
    const again = await ensureCommercialConstraints(db);
    assert.equal(again.featureIndex, true);
    assert.equal(again.subscriptionIndex, true);
  } finally { await client.close(); }
});

test('contrato manual: assinatura, organização e auditoria mudam atomicamente', async () => {
  const {client, db} = await fixture();
  try {
    await ensureCommercialConstraints(db);
    const result = await activateManualContractAtomic(db, actor, 1, 'padrao', 'Contrato manual assinado');
    assert.ok(result.subscriptionId > 0);
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, 1));
    assert.equal(tenant.status, 'active');
    assert.equal(tenant.planKey, 'padrao');
    const subs = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, 1));
    assert.equal(subs.length, 1);
    assert.equal(subs[0].gateway, 'manual');
    const audit = await db.select().from(schema.auditEvents);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'CONTRACT_MANUAL_ACTIVATION');
    assert.equal(audit[0].tenantId, 1);
    await activateManualContractAtomic(db, actor, 1, 'empresa', 'Atualização de contrato manual');
    const all = await db.select().from(schema.subscriptions);
    assert.equal(all.length, 1);
    assert.equal(all[0].planKey, 'empresa');
    assert.equal((await db.select().from(schema.auditEvents)).length, 2);
    await assert.rejects(() => activateManualContractAtomic(db, actor, 1, 'desconhecido', 'Plano sem cadastro'));
    assert.equal((await db.select().from(schema.auditEvents)).length, 2);
    assert.equal((await db.select().from(schema.subscriptions))[0].planKey, 'empresa');
  } finally { await client.close(); }
});

test('contrato gerenciado não pode ser convertido, e nenhuma alteração parcial é feita', async () => {
  const {client, db} = await fixture();
  try {
    await ensureCommercialConstraints(db);
    await db.insert(schema.subscriptions).values({
      tenantId:1,planKey:'empresa',status:'active',gateway:'stripe',gatewayId:'stripe-sub-123',
    });
    await assert.rejects(() => activateManualContractAtomic(db, actor, 1, 'padrao', 'Tentativa manual'));
    const [tenant] = await db.select().from(schema.tenants);
    assert.equal(tenant.status, 'pending');
    assert.equal((await db.select().from(schema.subscriptions)).length, 1);
    assert.equal((await db.select().from(schema.auditEvents)).length, 0);
  } finally { await client.close(); }
});

test('permissões: duas alterações mantêm um único override e dois eventos registrados', async () => {
  const {client, db} = await fixture();
  try {
    await ensureCommercialConstraints(db);
    await setFeatureOverrideAtomic(db, actor, {
      tenantId:1,featureKey:'ai_enabled',enabled:true,reason:'Módulo comercial contratado',expiresAt:null,
    });
    await setFeatureOverrideAtomic(db, actor, {
      tenantId:1,featureKey:'ai_enabled',enabled:false,reason:'Restrição por contrato',expiresAt:null,
    });
    const overrides = await db.select().from(schema.tenantFeatures);
    assert.equal(overrides.length, 1);
    assert.equal(overrides[0].enabled, 0);
    assert.equal((await db.select().from(schema.auditEvents)).length, 2);
    await assert.rejects(() => setFeatureOverrideAtomic(db, actor, {
      tenantId:999,featureKey:'ai_enabled',enabled:true,reason:'Cliente inexistente',expiresAt:null,
    }));
    assert.equal((await db.select().from(schema.auditEvents)).length, 2);
  } finally { await client.close(); }
});

test('dados legados com duplicidade bloqueiam escrita, sem apagar registros', async () => {
  const {client, db} = await fixture();
  try {
    await db.insert(schema.tenantFeatures).values([
      {tenantId:1,featureKey:'ai_enabled',enabled:1},
      {tenantId:1,featureKey:'ai_enabled',enabled:0},
    ]);
    const status = await ensureCommercialConstraints(db);
    assert.equal(status.featureIndex, false);
    assert.equal(status.duplicateFeatures.length, 1);
    assert.equal(status.subscriptionIndex, true);
    await assert.rejects(() => setFeatureOverrideAtomic(db, actor, {
      tenantId:1,featureKey:'ai_enabled',enabled:true,reason:'Deve bloquear',expiresAt:null,
    }), /Proteção de unicidade pendente/);
    assert.equal((await db.select().from(schema.tenantFeatures)).length, 2);
    const report = await commercialConstraintReport(db);
    assert.equal(report.duplicateFeatures.length, 1);
  } finally { await client.close(); }
});

test('índice parcial impede duas assinaturas vigentes para o mesmo cliente', async () => {
  const {client, db} = await fixture();
  try {
    await ensureCommercialConstraints(db);
    await activateManualContractAtomic(db, actor, 1, 'padrao', 'Assinatura inicial');
    await assert.rejects(() => db.insert(schema.subscriptions).values({
      tenantId:1,planKey:'empresa',gateway:'manual',status:'past_due',
    }));
    await db.insert(schema.subscriptions).values({
      tenantId:1,planKey:'empresa',gateway:'manual',status:'cancelled',
    });
    const subs = await db.select().from(schema.subscriptions);
    assert.equal(subs.length, 2);
  } finally { await client.close(); }
});
