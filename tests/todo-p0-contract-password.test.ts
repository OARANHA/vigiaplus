import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { canUseBusinessSurface } from '../lib/password-access';

test('SEC-02: uma senha temporária não abre áreas administrativas, exportações ou APIs', () => {
  for (const path of ['/', '/login', '/portal', '/console', '/console/admin',
    '/api/app/evidence', '/api/console/tenants', '/api/export/pdf', '/api/notifications/rules']) {
    assert.equal(canUseBusinessSurface(1, path), false, path);
  }
  assert.equal(canUseBusinessSurface(1, '/impostazioni/account'), true);
  assert.equal(canUseBusinessSurface(1, '/impostazioni/account/'), true);
  assert.equal(canUseBusinessSurface(1, null), false);
  assert.equal(canUseBusinessSurface(0, '/api/app/evidence'), true);
  const auth = readFileSync('lib/auth.ts', 'utf8');
  assert.match(auth, /canUseBusinessSurface\(u\.mustChangePassword, pathname\)/);
  assert.match(auth, /if \(!canUseBusinessSurface\(u\.mustChangePassword, pathname\)\) return null/);
  const actions = readFileSync('app/account/actions.ts', 'utf8');
  assert.match(actions, /mustChangePassword: 0/);
  assert.match(actions, /sessionVersion: sql/);
});

const directory = mkdtempSync(join(tmpdir(), 'vpx-tenant-audit-'));
process.env.PGLITE_DIR = directory;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;
let dbMod: typeof import('../lib/db');
let schema: typeof import('../lib/db/schema');
let evidence: typeof import('../app/api/app/evidence/route');
let entitlement: typeof import('../lib/tenant/entitlements');

test('SEC-01: duas organizações isoladas; suspender contrato bloqueia feature e sem vínculo não abre legado', async () => {
  try {
    dbMod = await import('../lib/db');
    schema = await import('../lib/db/schema');
    evidence = await import('../app/api/app/evidence/route');
    entitlement = await import('../lib/tenant/entitlements');
    const db = await dbMod.getDb();
    const [a, b, pending] = await db.insert(schema.tenants).values([
      { name: 'Alfa Auditoria', slug: 'alfa-auditoria', status: 'active', planKey: 'padrao' },
      { name: 'Beta Auditoria', slug: 'beta-auditoria', status: 'active', planKey: 'padrao' },
      { name: 'Pendente', slug: 'pendente-auditoria', status: 'pending', planKey: 'padrao' },
    ]).returning();
    await db.insert(schema.subscriptions).values([
      { tenantId: a.id, planKey:'padrao', status:'active' },
      { tenantId: b.id, planKey:'padrao', status:'active' },
      { tenantId: pending.id, planKey:'padrao', status:'active' },
    ]);
    const [projectA, projectB] = await db.insert(schema.projects).values([
      { name: 'Fonte Alfa', tenantId:a.id, visibility:'shared' },
      { name: 'Fonte Beta', tenantId:b.id, visibility:'shared' },
    ]).returning();
    await db.insert(schema.mentions).values([
      { projectId:projectA.id, source:'rss', externalId:'alfa-1',
        title:'Conteúdo exclusivo Alfa', publishedAt:new Date('2026-11-09T12:00:00Z') },
      { projectId:projectB.id, source:'rss', externalId:'beta-1',
        title:'Conteúdo exclusivo Beta', publishedAt:new Date('2026-11-09T12:00:00Z') },
    ]);
    const rowsA = await evidence.listTenantEvidence(db, a.id);
    const rowsB = await evidence.listTenantEvidence(db, b.id);
    assert.deepEqual(rowsA.map(x=>x.title), ['Conteúdo exclusivo Alfa']);
    assert.deepEqual(rowsB.map(x=>x.title), ['Conteúdo exclusivo Beta']);

    const ctx = (tenantId:number) => ({
      tenantId, userId: 128, userName:'Cliente QA', role:'client_admin' as const,
      system:false, surface:'app' as const, density:'basico' as const,
      vocabulary:'leigo' as const, ip:null, requestId:'qa-test',
    });
    assert.equal((await entitlement.featureState(ctx(a.id), 'reputation_dual')).enabled, true);
    assert.equal((await entitlement.featureState(ctx(pending.id), 'reputation_dual')).enabled, false);
    await db.update(schema.tenants).set({status:'suspended'}).where(eq(schema.tenants.id, a.id));
    assert.equal((await entitlement.featureState(ctx(a.id), 'reputation_dual')).enabled, false);
    await db.update(schema.tenants).set({status:'active'}).where(eq(schema.tenants.id, a.id));
    await db.update(schema.subscriptions).set({status:'cancelled'}).where(eq(schema.subscriptions.tenantId,a.id));
    assert.equal((await entitlement.featureState(ctx(a.id), 'reputation_dual')).enabled, false);
    const routeSource=readFileSync('app/api/app/evidence/route.ts','utf8');
    assert.match(routeSource, /await requireFeature\(ctx, 'reputation_dual'\)/);
    const summarySource=readFileSync('app/api/app/summary/route.ts','utf8');
    assert.match(summarySource, /await requireFeature\(ctx, 'reputation_dual'\)/);
    const projectAccess=readFileSync('lib/data.ts','utf8');
    assert.match(projectAccess, /visibleProjectsFor\(db, null\)/);
  } finally {
    // A conexão PGlite global é encerrada somente com o processo de testes.
    // O diretório temporário pode permanecer ocupado no Windows.
  }
});
