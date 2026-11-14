/**
 * ALT-08.10C.34 PostgreSQL 16-only adversarial rehearsal. Runs in a fresh
 * GitHub Actions service, NEVER against Neon/staging/operational DB.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {
  policyExpressionDigest, preflightExclusiveTenantPolicy,
  withDisposableScopedRead, type ExclusivePolicyContract,
} from '../../lib/db/alt0810c34-policy-pool-guard';
import {
  withDedicatedTenantClient, type DedicatedClient, type DedicatedPool,
} from '../../lib/db/alt0810c33-operational-contract';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
   e.ALT0810C34_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
   e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
   e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
   e.DATABASE_URL||e.RLS_DATABASE_URL||!e.RUNNER_TEMP||
   e.NODE_ENV==='production') throw Error('ALT0810C34_DISPOSABLE_ONLY');

type Pooled=DedicatedPool&{end():Promise<void>};
type Admin={connect():Promise<void>;query(sql:string,params?:unknown[]):Promise<{
  rows:Record<string,unknown>[];
}>;end():Promise<void>};
const {Client,Pool}=createRequire(import.meta.url)('pg') as {
 Client:new(o:Record<string,unknown>)=>Admin;
 Pool:new(o:Record<string,unknown>)=>Pooled;
};
const cfg={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
  user:'vigia_ci',password:'isolated_ci_only'};
const ns='alt0810c34_scope',reader='alt0810c34_reader',
  executor='alt0810c34_executor',broad='alt0810c34_broad';
const admin=new Client(cfg);

async function mustDeny(pool:Pooled,scope:ExclusivePolicyContract):Promise<void>{
 await assert.rejects(
   withDedicatedTenantClient(pool,db=>preflightExclusiveTenantPolicy(db,scope)),
   /ALT0810C34_POLICY_DRIFT_DENIED|ALT0810C33_RLS_PREFLIGHT_DENIED/,
 );
}
async function ids(pool:Pooled,tenantId:number):Promise<number[]>{
 return withDisposableScopedRead(pool,{tenantId,readerRole:reader},async db=>{
   const r=await db.query(`SELECT id FROM ${ns}.evidence ORDER BY id`);
   return r.rows.map(row=>Number(row.id));
 });
}
const newTenantPolicy=`CREATE POLICY c34_tenant ON ${ns}.evidence
 AS PERMISSIVE FOR SELECT TO ${reader}
 USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer)`;

test('ALT-08.10C.34 exclusive policy drift, PUBLIC/role inheritance, pool isolation and saturation',
 {timeout:30000},async()=>{
 await admin.connect();
 let pool:Pooled|undefined;
 let created=false;
 try{
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS n',[ns])).rows[0].n,null);
  for(const name of [reader,executor,broad])
   assert.equal((await admin.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[name])).rows.length,0);
  created=true;
  await admin.query(`CREATE ROLE ${reader} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await admin.query(`CREATE ROLE ${executor} LOGIN PASSWORD 'ci34_executor_only'
    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await admin.query(`CREATE ROLE ${broad} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await admin.query(`CREATE SCHEMA ${ns}`);
  await admin.query(`CREATE TABLE ${ns}.users (id integer)`);
  await admin.query(`CREATE TABLE ${ns}.evidence (id integer,tenant_id integer,private_text text)`);
  await admin.query(`INSERT INTO ${ns}.evidence VALUES (1,101,'private-A'),(2,202,'private-B')`);
  await admin.query(`GRANT ${reader} TO ${executor}`);
  await admin.query(`GRANT USAGE ON SCHEMA ${ns} TO ${reader},${executor}`);
  await admin.query(`GRANT SELECT (id,tenant_id) ON ${ns}.evidence TO ${reader}`);
  await admin.query(`ALTER TABLE ${ns}.evidence ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE ${ns}.evidence FORCE ROW LEVEL SECURITY`);
  await admin.query(newTenantPolicy);
  const baseline=await admin.query(`SELECT qual FROM pg_policies WHERE schemaname=$1
     AND tablename='evidence' AND policyname='c34_tenant'`,[ns]);
  assert.equal(baseline.rows.length,1);
  assert.equal(typeof baseline.rows[0].qual,'string');
  const scope:ExclusivePolicyContract={
    schema:ns,table:'evidence',readerRole:reader,executorRole:executor,
    expectedPolicyName:'c34_tenant',
    expectedUsingSha256:policyExpressionDigest(String(baseline.rows[0].qual)),
  };
  pool=new Pool({...cfg,user:executor,password:'ci34_executor_only',max:2,
    connectionTimeoutMillis:1000,idleTimeoutMillis:1000});
  const activePool=pool;
  const preflight=()=>withDedicatedTenantClient(activePool,
    db=>preflightExclusiveTenantPolicy(db,scope));
  await preflight();
  assert.deepEqual(await ids(activePool,101),[1]);
  assert.deepEqual(await ids(activePool,202),[2]);
  await assert.rejects(
    withDisposableScopedRead(activePool,{tenantId:101,readerRole:reader},
      async db=>db.query(`SELECT private_text FROM ${ns}.evidence`)),
    /permission denied/i,
    'the read role must not access private_text through a column grant',
  );
  const missing=await withDedicatedTenantClient(activePool,async db=>{
    await db.query('BEGIN READ ONLY');
    await db.query(`SET LOCAL ROLE "${reader}"`);
    const r=await db.query(`SELECT id FROM ${ns}.evidence`);
    return r.rows;
  });
  assert.deepEqual(missing,[],'no GUC means no visible rows');
  const clean=await withDedicatedTenantClient(activePool,async db=>{
    const r=await db.query(`SELECT current_user AS who,
       NULLIF(current_setting('app.tenant_id',true),'') AS tid`);
    return r.rows[0];
  });
  assert.equal(clean.who,executor);
  assert.equal(clean.tid,null);
  await assert.rejects(withDisposableScopedRead(activePool,{tenantId:0,readerRole:reader},
    async db=>db.query('SELECT 1')),/ALT0810C34_SCOPE_DENIED/);
  await assert.rejects(withDisposableScopedRead(activePool,{tenantId:101,readerRole:reader},
    async db=>db.query('COMMIT')),/ALT0810C34_QUERY_DENIED/);
  await assert.rejects(withDisposableScopedRead(activePool,{tenantId:101,readerRole:reader},
    async db=>db.query(`SELECT id FROM ${ns}.evidence; COMMIT`)),
    /ALT0810C34_QUERY_DENIED/);

  // A permissive PUBLIC policy is ORed with the intended policy.
  await admin.query(`CREATE POLICY c34_public ON ${ns}.evidence
    FOR SELECT TO PUBLIC USING(true)`);
  await mustDeny(activePool,scope);
  assert.deepEqual(await ids(activePool,101),[1,2],
    'the fixture MUST demonstrate the broadening caused by the injected policy');
  await admin.query(`DROP POLICY c34_public ON ${ns}.evidence`);
  await preflight();

  // A policy inherited through an additional group role also ORs in.
  await admin.query(`GRANT ${broad} TO ${reader}`);
  await admin.query(`CREATE POLICY c34_inherited ON ${ns}.evidence
    FOR SELECT TO ${broad} USING(true)`);
  await mustDeny(activePool,scope);
  assert.deepEqual(await ids(activePool,101),[1,2]);
  await admin.query(`DROP POLICY c34_inherited ON ${ns}.evidence`);
  await preflight();

  // Indirect auth-table privilege must not be present on the read role.
  await admin.query(`GRANT SELECT ON ${ns}.users TO ${broad}`);
  await mustDeny(activePool,scope);
  await admin.query(`REVOKE SELECT ON ${ns}.users FROM ${broad}`);
  await admin.query(`REVOKE ${broad} FROM ${reader}`);
  await preflight();

  // Any unexpected policy, even on a different command, needs review.
  await admin.query(`CREATE POLICY c34_write ON ${ns}.evidence
    FOR UPDATE TO ${reader} USING(true)`);
  await mustDeny(activePool,scope);
  await admin.query(`DROP POLICY c34_write ON ${ns}.evidence`);
  await preflight();

  // Catalog predicate drift is rejected even if its name/role still match.
  await admin.query(`DROP POLICY c34_tenant ON ${ns}.evidence`);
  await admin.query(`CREATE POLICY c34_tenant ON ${ns}.evidence
    FOR SELECT TO ${reader} USING(true)`);
  await mustDeny(activePool,scope);
  assert.deepEqual(await ids(activePool,101),[1,2]);
  await admin.query(`DROP POLICY c34_tenant ON ${ns}.evidence`);
  await admin.query(newTenantPolicy);
  await preflight();

  await admin.query(`GRANT SELECT ON ${ns}.evidence TO PUBLIC`);
  await mustDeny(activePool,scope);
  await admin.query(`REVOKE SELECT ON ${ns}.evidence FROM PUBLIC`);
  await admin.query(`GRANT SELECT (private_text) ON ${ns}.evidence TO PUBLIC`);
  await mustDeny(activePool,scope);
  await admin.query(`REVOKE SELECT (private_text) ON ${ns}.evidence FROM PUBLIC`);
  await admin.query(`GRANT UPDATE (id) ON ${ns}.evidence TO ${reader}`);
  await mustDeny(activePool,scope);
  await admin.query(`REVOKE UPDATE (id) ON ${ns}.evidence FROM ${reader}`);
  await admin.query(`GRANT USAGE ON SCHEMA ${ns} TO PUBLIC`);
  await mustDeny(activePool,scope);
  await admin.query(`REVOKE USAGE ON SCHEMA ${ns} FROM PUBLIC`);
  await preflight();

  // With a max=2 pool, concurrent tenant scopes cannot share a connection.
  // A third request must timeout rather than inherit tenant context.
  let unblockA:()=>void=()=>{},unblockB:()=>void=()=>{};
  let markA:()=>void=()=>{},markB:()=>void=()=>{};
  const holdA=new Promise<void>(r=>{unblockA=r});
  const holdB=new Promise<void>(r=>{unblockB=r});
  const readyA=new Promise<void>(r=>{markA=r});
  const readyB=new Promise<void>(r=>{markB=r});
  const first=withDisposableScopedRead(activePool,{tenantId:101,readerRole:reader},
    async db=>{const r=await db.query(`SELECT id FROM ${ns}.evidence ORDER BY id`);
      markA();await holdA;return r.rows.map(x=>Number(x.id))});
  const second=withDisposableScopedRead(activePool,{tenantId:202,readerRole:reader},
    async db=>{const r=await db.query(`SELECT id FROM ${ns}.evidence ORDER BY id`);
      markB();await holdB;return r.rows.map(x=>Number(x.id))});
  try{
    await Promise.all([readyA,readyB]);
    await assert.rejects(ids(activePool,101),/timeout/i);
  }finally{unblockA();unblockB()}
  assert.deepEqual(await Promise.all([first,second]),[[1],[2]]);
  assert.deepEqual(await ids(activePool,101),[1]);
  assert.deepEqual(await ids(activePool,202),[2]);
  console.log('ALT0810C34 PG16: policy OR/PUBLIC/inherited/predicate drift denied; role isolation, READ ONLY rollback, pool max=2 saturation, no stale GUC/role; operational NO-GO');
 }finally{
  await pool?.end().catch(()=>{});
  if(created){
   await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   await admin.query(`REVOKE ${broad} FROM ${reader}`).catch(()=>{});
   await admin.query(`REVOKE ${reader} FROM ${executor}`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${executor}`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${reader}`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${broad}`).catch(()=>{});
  }
  await admin.end();
 }
});
