import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { createPolicyCandidateSql, RLS_CANDIDATE_SPECS } from '../lib/tenant/rls-policy-candidate';
import { TENANT_RLS_TABLES, assessRlsReadiness } from '../lib/tenant/rls-preflight';

test('SEC-04: nenhuma tabela com tenant_id no schema fica fora do catálogo RLS',()=>{
  const source=readFileSync('lib/db/schema.ts','utf8');
  const tenantTables=[...source.matchAll(/export const \w+\s*=\s*pgTable\('([^']+)',\s*\{([\s\S]*?)\n\}\);/g)]
    .filter((x)=>/tenantId\s*:/.test(x[2]))
    .map((x)=>x[1]);
  assert.ok(tenantTables.length>=17,'Inventário regrediu ou parser deixou de encontrar os tenants');
  const policyTables=new Set(RLS_CANDIDATE_SPECS.map((x)=>x.table));
  const preflightTables=new Set<string>(TENANT_RLS_TABLES);
  for(const name of tenantTables){
    assert.ok(policyTables.has(name),'Tabela com tenant_id sem policy: '+name);
    assert.ok(preflightTables.has(name),'Preflight não verifica tabela: '+name);
  }
  for(const name of ['llm_providers','llm_routes']){
    assert.ok(RLS_CANDIDATE_SPECS.some(x=>x.table===name&&x.kind==='tenant'));
    const spec=RLS_CANDIDATE_SPECS.find(x=>x.table===name)!;
    const sql=createPolicyCandidateSql([spec]);
    assert.match(sql,/WITH CHECK/);
    assert.match(sql,/current_setting\('app\.tenant_id', true\)/);
    assert.doesNotMatch(sql,/\sOR\s/i);
  }
});

test('SEC-04: catálogo de prontidão reprova ausência de proteção nos modelos de IA',()=>{
  const tables=TENANT_RLS_TABLES.map(name=>({name,owner:'migrator',rlsEnabled:true,forceRls:true}));
  const policies=TENANT_RLS_TABLES
    .filter(name=>name!=='llm_providers')
    .map(table=>({table,qualification:"tenant_id = current_setting('app.tenant_id',true)::integer",
      withCheck:"tenant_id = current_setting('app.tenant_id',true)::integer"}));
  const errors=assessRlsReadiness({
    role:{role:'vigiaplus_app',superuser:false,bypassRls:false},
    tables,policies,connectionDriver:'transactional',
  });
  assert.ok(errors.some(x=>x.includes('llm_providers')),'Sem policy de modelos IA precisa ser NO-GO');
});

test('SEC-04: role restrita não lê globais nem dados de IA de outro cliente; DML falha fechado',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      CREATE TABLE llm_providers(id text PRIMARY KEY,tenant_id integer);
      CREATE TABLE llm_routes(id integer PRIMARY KEY,tenant_id integer);
      INSERT INTO llm_providers VALUES ('global',NULL),('alfa',1),('beta',2);
      INSERT INTO llm_routes VALUES (100, NULL),(101,1),(202,2);
      CREATE ROLE vigia_rls_llm;
      GRANT USAGE ON SCHEMA public TO vigia_rls_llm;
      GRANT SELECT, INSERT, UPDATE, DELETE ON llm_providers,llm_routes TO vigia_rls_llm;
    `);
    await db.exec(createPolicyCandidateSql([
      {table:'llm_providers',kind:'tenant'}, {table:'llm_routes',kind:'tenant'},
    ]));
    await db.exec('SET ROLE vigia_rls_llm;');
    assert.deepEqual((await db.query<{id:string}>('SELECT id FROM llm_providers')).rows,[]);
    assert.deepEqual((await db.query<{id:number}>('SELECT id FROM llm_routes')).rows,[]);

    await db.exec('BEGIN;');
    await db.exec("SET LOCAL app.tenant_id = '1';");
    const a=await db.query<{id:string}>('SELECT id FROM llm_providers ORDER BY id');
    assert.deepEqual(a.rows.map(x=>x.id),['alfa']);
    assert.deepEqual((await db.query<{id:number}>('SELECT id FROM llm_routes ORDER BY id'))
      .rows.map(x=>x.id),[101]);
    assert.equal((await db.query('UPDATE llm_providers SET tenant_id=1 WHERE id=\'beta\' RETURNING id')).rows.length,0);
    assert.equal((await db.query('DELETE FROM llm_routes WHERE id=202 RETURNING id')).rows.length,0);
    await assert.rejects(db.exec("INSERT INTO llm_providers VALUES ('invasao',2)"),/row-level security/i);
    await db.exec('ROLLBACK;');

    await db.exec('BEGIN;');
    await db.exec("SET LOCAL app.tenant_id = '2';");
    assert.deepEqual((await db.query<{id:string}>('SELECT id FROM llm_providers ORDER BY id'))
      .rows.map(x=>x.id),['beta']);
    assert.deepEqual((await db.query<{id:number}>('SELECT id FROM llm_routes ORDER BY id'))
      .rows.map(x=>x.id),[202]);
    await db.exec('ROLLBACK;');
    assert.equal((await db.query('SELECT id FROM llm_providers')).rows.length,0,
      'SET LOCAL não pode sobreviver à transação');
  }finally{
    await db.close();
  }
});
