/**
 * ALT-08.10C.36 — COMMIT then compensating restore, PostgreSQL 16 service ONLY.
 * The only mutable objects belong to this test in a disposable GitHub runner.
 * No staging/Neon/production URLs and no application migration entrypoint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {
  validateC36Plan,readC36Catalog,assertC36LeastPrivilege,
  assertC36Restored,c36CatalogDigest,type C36Catalog,type PgCatalogQuery,
} from '../../lib/db/alt0810c36-preoperational-audit';
import {validateC35Manifest} from '../../lib/db/alt0810c35-operational-manifest';
import {
  preflightExclusiveTenantPolicy,policyExpressionDigest,withDisposableScopedRead,
} from '../../lib/db/alt0810c34-policy-pool-guard';
import {withDedicatedTenantClient,type DedicatedPool} from
  '../../lib/db/alt0810c33-operational-contract';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
   e.ALT0810C36_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
   e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
   e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
   e.DATABASE_URL||e.RLS_DATABASE_URL||e.NODE_ENV==='production'||
   !e.RUNNER_TEMP)throw Error('ALT0810C36_DISPOSABLE_ONLY');
const plan=validateC36Plan(JSON.parse(readFileSync(
  'schema/operational-rls/alt0810c36-prestaging-plan.json','utf8',
)) as unknown);
const c35=validateC35Manifest(JSON.parse(readFileSync(
  'schema/operational-rls/alt0810c35-disposable-manifest.json','utf8',
)) as unknown);
assert.equal(plan.approvedPredicateSourceSha256,c35.policy.usingSqlSha256);
const {schema,evidence,readerRole,executorRole,policyName}=plan.scope;
const {Client,Pool}=createRequire(import.meta.url)('pg') as {
  Client:new(o:Record<string,unknown>)=>PgCatalogQuery&{
    connect():Promise<void>;end():Promise<void>};
  Pool:new(o:Record<string,unknown>)=>DedicatedPool&{end():Promise<void>};
};
const cfg={host:'127.0.0.1',port:5432,user:'vigia_ci',
  password:'isolated_ci_only',database:'vigia_alt081_ci'};
const admin=new Client(cfg);
const observer=new Client(cfg);
const readRows=async(db:PgCatalogQuery,sql:string,p:unknown[]=[])=>(
  await db.query(sql,p)).rows;

/** The catalog-only auditor does not read customer data; synthetic fixture
 * row capture stays separate and is never exported to an operational path. */
async function snapshot(db:PgCatalogQuery):Promise<{
  catalog:C36Catalog;data:{id:number;tenantId:number}[];
}>{
  await db.query('BEGIN READ ONLY');
  try{
    const catalog=await readC36Catalog(db,plan);
    const data=(await readRows(db,
      `SELECT id,tenant_id FROM ${schema}.${evidence} ORDER BY id`))
      .map(x=>({id:Number(x.id),tenantId:Number(x.tenant_id)}));
    return {catalog,data};
  }finally{await db.query('ROLLBACK')}
}

test('ALT-08.10C.36 read-only catalog audit, post-COMMIT drift and atomic compensation',
 {timeout:60000},async()=>{
  await admin.connect();
  await observer.connect();
  let pool:(DedicatedPool&{end():Promise<void>})|undefined;
  let created=false;
  try{
    assert.equal((await readRows(admin,
      'SELECT to_regnamespace($1) AS namespace',[schema]))[0].namespace,null);
    for(const name of [executorRole,readerRole]){
      assert.equal((await readRows(admin,
        'SELECT rolname FROM pg_roles WHERE rolname=$1',[name])).length,0);
    }
    created=true;
    await admin.query(`CREATE ROLE ${readerRole}
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await admin.query(`CREATE ROLE ${executorRole} LOGIN PASSWORD 'ci36_executor_only'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await admin.query(`CREATE SCHEMA ${schema}`);
    for(const dep of plan.dependencies)
      await admin.query(`CREATE TABLE ${schema}.${dep} (id integer)`);
    await admin.query(`CREATE TABLE ${schema}.${evidence}
      (id integer,tenant_id integer,private_text text)`);
    await admin.query(`INSERT INTO ${schema}.${evidence}
      VALUES(1,101,'fixture-A'),(2,202,'fixture-B')`);
    await admin.query(`GRANT ${readerRole} TO ${executorRole}`);
    await admin.query(`GRANT USAGE ON SCHEMA ${schema}
      TO ${readerRole},${executorRole}`);
    await admin.query(`GRANT SELECT (id,tenant_id)
      ON ${schema}.${evidence} TO ${readerRole}`);
    await admin.query(`ALTER TABLE ${schema}.${evidence} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${schema}.${evidence} FORCE ROW LEVEL SECURITY`);
    await admin.query(`CREATE POLICY ${policyName} ON ${schema}.${evidence}
      AS PERMISSIVE FOR SELECT TO ${readerRole}
      USING (${c35.policy.usingSql})`);

    const baseline=await snapshot(observer);
    assertC36LeastPrivilege(plan,baseline.catalog);
    assert.deepEqual(baseline.data,
      [{id:1,tenantId:101},{id:2,tenantId:202}]);
    const baselineSha=c36CatalogDigest(baseline.catalog);
    const predicateSha=policyExpressionDigest(
      baseline.catalog.policies[0].using??'');
    pool=new Pool({...cfg,user:executorRole,password:'ci36_executor_only',
      max:2,connectionTimeoutMillis:1200,idleTimeoutMillis:1000});
    const active=pool;
    const preflight=()=>withDedicatedTenantClient(active,
      db=>preflightExclusiveTenantPolicy(db,{
        schema,table:evidence,readerRole,executorRole,
        expectedPolicyName:policyName,expectedUsingSha256:predicateSha,
      }));
    await preflight();
    for(const [tenantId,expected] of [[101,[1]],[202,[2]]] as const){
      const values=await withDisposableScopedRead(
        active,{tenantId,readerRole},
        async db=>(await db.query(
          `SELECT id FROM ${schema}.${evidence} ORDER BY id`
        )).rows.map(x=>Number(x.id)));
      assert.deepEqual(values,expected);
    }
    // Read-only transaction must actually reject DDL, before any mutation.
    await observer.query('BEGIN READ ONLY');
    try{
      await assert.rejects(observer.query(
        `CREATE TABLE ${schema}.forbidden_write (id integer)`),
        (err:unknown)=>(err as {code?:string}).code==='25006');
    }finally{await observer.query('ROLLBACK')}
    assertC36Restored(baseline.catalog,(await snapshot(observer)).catalog);

    // A separate independent connection sees all changes AFTER COMMIT.
    await admin.query('BEGIN');
    try{
      await admin.query(`ALTER POLICY ${policyName}
        ON ${schema}.${evidence} USING (true)`);
      await admin.query(`CREATE POLICY c36_public
        ON ${schema}.${evidence} FOR SELECT TO PUBLIC USING(true)`);
      await admin.query(`GRANT SELECT(private_text)
        ON ${schema}.${evidence} TO ${readerRole}`);
      await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO PUBLIC`);
      await admin.query(`GRANT SELECT ON ${schema}.users TO ${readerRole}`);
      await admin.query(`ALTER TABLE ${schema}.${evidence}
        NO FORCE ROW LEVEL SECURITY`);
      await admin.query(`GRANT ${readerRole}
        TO ${executorRole} WITH SET FALSE`);
      await admin.query(`ALTER ROLE ${readerRole} BYPASSRLS`);
      await admin.query(`UPDATE ${schema}.${evidence}
        SET tenant_id=202 WHERE id=1`);
      await admin.query('COMMIT');
    }catch(err){await admin.query('ROLLBACK');throw err}
    const committed=await snapshot(observer);
    assert.notEqual(c36CatalogDigest(committed.catalog),baselineSha);
    assert.throws(()=>assertC36Restored(baseline.catalog,committed.catalog),
      /ALT0810C36_CATALOG_DRIFT/);
    assert.throws(()=>assertC36LeastPrivilege(plan,committed.catalog),
      /ALT0810C36_PREFLIGHT_DENIED/);
    assert.deepEqual(committed.data,
      [{id:1,tenantId:202},{id:2,tenantId:202}]);

    // Inject failure during a compensating migration: rollback MUST leave
    // the committed drift visible, not claim restoration.
    await admin.query('BEGIN');
    try{
      await admin.query(`ALTER ROLE ${readerRole} NOBYPASSRLS`);
      await assert.rejects(admin.query('SELECT 1/0'),
        (err:unknown)=>(err as {code?:string}).code==='22012');
    }finally{await admin.query('ROLLBACK')}
    const afterFailure=await snapshot(observer);
    assert.deepEqual(afterFailure,committed);
    assert.throws(()=>assertC36Restored(baseline.catalog,afterFailure.catalog),
      /ALT0810C36_CATALOG_DRIFT/);

    // Compensate AFTER prior transaction COMMIT: this is a NEW transaction,
    // never ROLLBACK TO SAVEPOINT from ALT-08.10C.35.
    await admin.query('BEGIN');
    try{
      await admin.query(`ALTER POLICY ${policyName}
        ON ${schema}.${evidence} USING (${c35.policy.usingSql})`);
      await admin.query(`DROP POLICY c36_public ON ${schema}.${evidence}`);
      await admin.query(`REVOKE SELECT(private_text)
        ON ${schema}.${evidence} FROM ${readerRole}`);
      await admin.query(`REVOKE USAGE ON SCHEMA ${schema} FROM PUBLIC`);
      await admin.query(`REVOKE SELECT ON ${schema}.users FROM ${readerRole}`);
      await admin.query(`ALTER TABLE ${schema}.${evidence}
        FORCE ROW LEVEL SECURITY`);
      await admin.query(`GRANT ${readerRole}
        TO ${executorRole} WITH SET TRUE`);
      await admin.query(`ALTER ROLE ${readerRole} NOBYPASSRLS`);
      await admin.query(`UPDATE ${schema}.${evidence}
        SET tenant_id=101 WHERE id=1`);
      await admin.query('COMMIT');
    }catch(err){await admin.query('ROLLBACK');throw err}
    const recovered=await snapshot(observer);
    assertC36LeastPrivilege(plan,recovered.catalog);
    assertC36Restored(baseline.catalog,recovered.catalog);
    assert.equal(c36CatalogDigest(recovered.catalog),baselineSha);
    assert.deepEqual(recovered.data,baseline.data);
    await preflight();
    for(const [tenantId,expected] of [[101,[1]],[202,[2]]] as const){
      const values=await withDisposableScopedRead(
        active,{tenantId,readerRole},
        async db=>(await db.query(
          `SELECT id FROM ${schema}.${evidence} ORDER BY id`
        )).rows.map(x=>Number(x.id)));
      assert.deepEqual(values,expected);
    }
    console.log(JSON.stringify({
      gate:'ALT-08.10C.36',catalogSha256:baselineSha,
      scenarios:['READ_ONLY forbids DDL','COMMIT drift visible across sessions',
        'failed compensating transaction remains drifted',
        'new COMMIT restores catalog, data and tenant isolation'],
      operationalAuthorization:false,physicalBackupCertified:false,
    }));
  }finally{
    await pool?.end().catch(()=>{});
    if(created){
      await admin.query('ROLLBACK').catch(()=>{});
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>{});
      await admin.query(`REVOKE ${readerRole} FROM ${executorRole}`).catch(()=>{});
      await admin.query(`DROP ROLE IF EXISTS ${executorRole}`).catch(()=>{});
      await admin.query(`DROP ROLE IF EXISTS ${readerRole}`).catch(()=>{});
    }
    await observer.end().catch(()=>{});
    await admin.end().catch(()=>{});
  }
});
