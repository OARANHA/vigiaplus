import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vigia-shell-portal-'));
process.env.PGLITE_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;
delete process.env.VIGIA_SEED_SAMPLE_TENANTS;

type DbMod = typeof import('../lib/db');
type Schema = typeof import('../lib/db/schema');
let dbMod: DbMod;
let schema: Schema;

before(async () => {
  dbMod = await import('../lib/db');
  schema = await import('../lib/db/schema');
});
after(async () => {
  if (dbMod) {
    const db = await dbMod.getDb();
    const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
    await client?.close();
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

test('cliente A não vê publicações do cliente B, mesmo com externalId igual', async () => {
  const { listTenantEvidence } = await import('../app/api/app/evidence/route');
  const db = await dbMod.getDb();
  const [tenantA, tenantB] = await db.insert(schema.tenants).values([
    { name: 'Cliente A local', slug: 'shell-client-a' },
    { name: 'Cliente B local', slug: 'shell-client-b' },
  ]).returning();
  const [projectA, projectB] = await db.insert(schema.projects).values([
    { name: 'Projeto A', tenantId: tenantA.id, keywords: ['Cliente A'] },
    { name: 'Projeto B', tenantId: tenantB.id, keywords: ['Cliente B'] },
  ]).returning();
  const now = new Date();
  await db.insert(schema.mentions).values([
    { projectId: projectA.id, source: 'rss', externalId: 'same', title: 'Notícia cliente A',
      content: 'A', url: 'https://jornal.example/a', publishedAt: now },
    { projectId: projectB.id, source: 'rss', externalId: 'same', title: 'Notícia cliente B',
      content: 'B', url: 'https://jornal.example/b', publishedAt: now },
  ]);
  const a = await listTenantEvidence(db, tenantA.id);
  const b = await listTenantEvidence(db, tenantB.id);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(a[0].title, 'Notícia cliente A');
  assert.equal(b[0].title, 'Notícia cliente B');
  assert.notEqual(a[0].projectName, b[0].projectName);
  await assert.rejects(() => listTenantEvidence(db, -1), /Tenant inválido/);
});

test('login público usa layout em duas colunas sem sidebar administrativa', () => {
  const root = readFileSync(join(process.cwd(), 'app/layout.tsx'), 'utf8');
  const login = readFileSync(join(process.cwd(), 'app/login/page.tsx'), 'utf8');
  const proxy = readFileSync(join(process.cwd(), 'proxy.ts'), 'utf8');
  assert.match(root, /pageIsPublic \|\| pageIsClient/);
  assert.match(root, /redirect\('\/portal'\)/);
  assert.match(proxy, /x-vigia-request-path/);
  assert.match(login, /va-story/);
  assert.match(login, /va-login-side/);
  assert.match(login, /getCurrentUser/);
});

test('cliente não herda console nem credenciais de outros tenants pela API de evidências', () => {
  const code = readFileSync(join(process.cwd(), 'app/api/app/evidence/route.ts'), 'utf8');
  const portal = readFileSync(join(process.cwd(), 'app/portal/page.tsx'), 'utf8');
  const loginAPI = readFileSync(join(process.cwd(), 'app/api/auth/route.ts'), 'utf8');
  assert.match(code, /resolveTenantContext/);
  assert.match(code, /eq\(projects\.tenantId, tenantId\)/);
  assert.match(code, /requireSurface\(ctx, 'app'\)/);
  assert.match(portal, /aria-label="Navegação do cliente"/);
  assert.match(portal, /Nenhuma publicação coletada/);
  assert.match(loginAPI, /redirectTo/);
});
