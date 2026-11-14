/**
 * ALT-08.10C.33 — isolated PG16 privilege/role/pool contract rehearsal.
 * No operational schemas, credentials, migration or Neon access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {
 preflightTenantRls,withDedicatedTenantClient,
 type DedicatedPool,type DedicatedClient,
} from '../../lib/db/alt0810c33-operational-contract';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
 e.ALT0810C33_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
 e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
 e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
 e.DATABASE_URL||e.RLS_DATABASE_URL||!e.RUNNER_TEMP||e.NODE_ENV==='production')
 throw Error('ALT0810C33_DISPOSABLE_ONLY');

type Port=DedicatedClient&{connect():Promise<void>;end():Promise<void>};
type AdminPort={connect():Promise<void>;query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[]}>;end():Promise<void>};
const {Client,Pool}=createRequire(import.meta.url)('pg') as {
 Client:new(o:Record<string,unknown>)=>AdminPort;
 Pool:new(o:Record<string,unknown>)=>DedicatedPool&{end():Promise<void>};
};
const cfg={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
 user:'vigia_ci',password:'isolated_ci_only'};
const ns='alt0810c33_scope',role='alt0810c33_reader',executor='alt0810c33_executor';
const admin=new Client(cfg);
const scope={schema:ns,table:'evidence',readerRole:role,executorRole:executor};

test('ALT-08.10C.33 PG16 dedicated pooled client, ACL audit and safe rollback',async()=>{
 await admin.connect();
 let created=false;
 let pool:(DedicatedPool&{end():Promise<void>})|undefined;
 try{
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS n',[ns])).rows[0].n,null);
  for(const value of [role,executor])
   assert.equal((await admin.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[value])).rows.length,0);
  created=true;
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await admin.query(`CREATE ROLE ${executor} LOGIN PASSWORD 'ci33_executor_only'
    NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await admin.query(`CREATE SCHEMA ${ns}`);
  await admin.query(`CREATE TABLE ${ns}.users(id integer)`);
  await admin.query(`CREATE TABLE ${ns}.memberships(id integer)`);
  await admin.query(`CREATE TABLE ${ns}.tenants(id integer)`);
  await admin.query(`CREATE TABLE ${ns}.subscriptions(id integer)`);
  await admin.query(`CREATE TABLE ${ns}.tenant_features(id integer)`);
  await admin.query(`CREATE TABLE ${ns}.plan_features(id integer)`);
  await admin.query(`CREATE TABLE ${ns}.evidence(id integer,tenant_id integer)`);
  await admin.query(`INSERT INTO ${ns}.evidence VALUES(1,101),(2,202)`);
  await admin.query(`GRANT ${role} TO ${executor}`);
  await admin.query(`GRANT USAGE ON SCHEMA ${ns} TO ${role},${executor}`);
  await admin.query(`GRANT SELECT ON ${ns}.evidence TO ${role}`);
  await admin.query(`GRANT SELECT ON ${ns}.users,${ns}.memberships,
    ${ns}.tenants,${ns}.subscriptions,${ns}.tenant_features,
    ${ns}.plan_features TO ${executor}`);
  await admin.query(`ALTER TABLE ${ns}.evidence ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE ${ns}.evidence FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY ci33_scope ON ${ns}.evidence FOR SELECT TO ${role}
   USING(tenant_id=COALESCE(NULLIF(current_setting('app.tenant_id',true),''),'0')::int)`);
  pool=new Pool({...cfg,user:executor,password:'ci33_executor_only',
    max:2,idleTimeoutMillis:1000,connectionTimeoutMillis:5000,
    options:`-c search_path=${ns}`});
  await withDedicatedTenantClient(pool,async db=>preflightTenantRls(db,scope));
  const ids=await withDedicatedTenantClient(pool,async db=>{
   await db.query('BEGIN');
   await db.query(`SET LOCAL ROLE ${role}`);
   await db.query('SELECT set_config($1,$2,true)',['app.tenant_id','101']);
   const r=await db.query(`SELECT id FROM ${ns}.evidence ORDER BY id`);
   return r.rows.map(x=>Number(x.id));
  });
  assert.deepEqual(ids,[1]);
  const clean=await withDedicatedTenantClient(pool,async db=>{
   const r=await db.query(`SELECT current_user AS who,
     NULLIF(current_setting('app.tenant_id',true),'') AS tid`);
   return r.rows[0];
  });
  assert.equal(clean.who,executor);
  assert.equal(clean.tid,null);

  await admin.query(`ALTER TABLE ${ns}.evidence NO FORCE ROW LEVEL SECURITY`);
  await assert.rejects(withDedicatedTenantClient(pool,async db=>preflightTenantRls(db,scope)),
   /ALT0810C33_RLS_PREFLIGHT_DENIED/);
  await admin.query(`ALTER TABLE ${ns}.evidence FORCE ROW LEVEL SECURITY`);

  await admin.query(`GRANT SELECT ON ${ns}.users TO ${role}`);
  await assert.rejects(withDedicatedTenantClient(pool,async db=>preflightTenantRls(db,scope)),
   /ALT0810C33_RLS_PREFLIGHT_DENIED/);
  await admin.query(`REVOKE SELECT ON ${ns}.users FROM ${role}`);

  await admin.query(`REVOKE ${role} FROM ${executor}`);
  await assert.rejects(withDedicatedTenantClient(pool,async db=>preflightTenantRls(db,scope)),
   /ALT0810C33_RLS_PREFLIGHT_DENIED/);
  await admin.query(`GRANT ${role} TO ${executor}`);
  await withDedicatedTenantClient(pool,async db=>preflightTenantRls(db,scope));
  console.log('ALT0810C33 PG16: real restricted pool, role membership, FORCE RLS, auth-table ACL denied, tenant-scoped read, rollback cleans role/GUC; NO-GO operational');
 }finally{
  await pool?.end().catch(()=>{});
  if(created){
   await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   await admin.query(`REVOKE ${role} FROM ${executor}`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${executor}`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await admin.end();
 }
});
