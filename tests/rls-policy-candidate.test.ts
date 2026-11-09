import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createPolicyCandidateSql, RLS_CANDIDATE_SPECS } from '../lib/tenant/rls-policy-candidate';

test('proposta RLS sem contexto permissivo nem política de escrita irrestrita', () => {
  const ddl = createPolicyCandidateSql();
  assert.ok(RLS_CANDIDATE_SPECS.length > 30);
  assert.match(ddl, /WITH CHECK/);
  assert.match(ddl, /EXISTS \(SELECT 1 FROM "projects"/);
  assert.ok(!/OR\s+current_setting/i.test(ddl));
});

test('PGlite: tenant sem contexto não lê, nem escreve dados de outro tenant', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE projects (id integer PRIMARY KEY, tenant_id integer NOT NULL);');
    await db.exec('CREATE TABLE mentions (id integer PRIMARY KEY, project_id integer NOT NULL);');
    await db.exec('INSERT INTO projects VALUES (11,1),(22,2); INSERT INTO mentions VALUES (101,11),(202,22);');
    await db.exec('CREATE ROLE vigia_rls_test;');
    await db.exec('GRANT USAGE ON SCHEMA public TO vigia_rls_test;');
    await db.exec('GRANT SELECT, INSERT, UPDATE, DELETE ON projects, mentions TO vigia_rls_test;');
    await db.exec(createPolicyCandidateSql([
      { table: 'projects', kind: 'tenant' },
      { table: 'mentions', kind: 'project-child' },
    ]));
    await db.exec('SET ROLE vigia_rls_test;');
    assert.equal((await db.query('SELECT id FROM projects')).rows.length, 0);
    assert.equal((await db.query('SELECT id FROM mentions')).rows.length, 0);
    await db.exec('BEGIN;');
    await db.exec("SET LOCAL app.tenant_id = '1';");
    assert.deepEqual((await db.query<{ id: number }>('SELECT id FROM projects')).rows.map((r) => r.id), [11]);
    assert.deepEqual((await db.query<{ id: number }>('SELECT id FROM mentions')).rows.map((r) => r.id), [101]);
    await db.exec('ROLLBACK;');
    await db.exec('BEGIN;');
    await db.exec("SET LOCAL app.tenant_id = '2';");
    assert.deepEqual((await db.query<{ id: number }>('SELECT id FROM projects')).rows.map((r) => r.id), [22]);
    assert.deepEqual((await db.query<{ id: number }>('SELECT id FROM mentions')).rows.map((r) => r.id), [202]);
    await db.exec('ROLLBACK;');
    await db.exec('BEGIN;');
    await db.exec("SET LOCAL app.tenant_id = '1';");
    await assert.rejects(db.query('INSERT INTO projects VALUES (33,2)'), /row-level security/i);
    await db.exec('ROLLBACK;');
  } finally {
    await db.close();
  }
});
