/**
 * ALT-08.10C.20: PostgreSQL16 disposal only, proving the scope runs on
 * one physical connection and transaction AFTER authenticated preflight.
 * Does NOT enable production Neon or trust arbitrary HTTP request data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {authorizeDisposableTenantScope} from '../../lib/tenant/alt0810c20-authz-preflight';
const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
 e.ALT0810C20_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
 e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
 e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
 e.DATABASE_URL||e.RLS_DATABASE_URL||e.NODE_ENV==='production')
 throw Error('ALT0810C20_DISPOSABLE_PG16_ONLY');
type Result={rows:Record<string,unknown>[];rowCount:number|null};
type DB={connect():Promise<void>;query(s:string,p?:unknown[]):Promise<Result>;end():Promise<void>};
const {Client}=createRequire(import.meta.url)('pg') as {Client:new(config:Record<string,unknown>)=>DB};
const db=new Client({host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
 user:'vigia_ci',password:'isolated_ci_only'});
const ns='alt0810c6_http_scope20',role='alt0810c6_http_reader20';
const principal={userId:1001,sessionVersion:4,verifiedSessionVersion:4,globalRole:'client' as const};
const membership={userId:1001,tenantId:101,role:'client_viewer' as const,active:true};
const contract={tenantId:101,status:'active' as const,subscriptionStatus:'active' as const,
 entitlementEnabled:true};
const scopedInput={principal,requestedTenantId:101,membership,contract};
test('ALT-08.10C.20: verified authz gate + PG16 SET LOCAL in same transaction',async()=>{
 await db.connect();let created=false,tx=false;
 try{
  assert.equal((await db.query('SELECT to_regnamespace($1) AS n',[ns])).rows[0].n,null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0);
  created=true;
  await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
  await db.query(`CREATE SCHEMA ${ns}`);
  await db.query(`CREATE TABLE ${ns}.observations(id int PRIMARY KEY,tenant_id int NOT NULL)`);
  await db.query(`INSERT INTO ${ns}.observations VALUES (1,101),(2,202)`);
  await db.query(`GRANT USAGE ON SCHEMA ${ns} TO ${role}`);
  await db.query(`GRANT SELECT ON ${ns}.observations TO ${role}`);
  await db.query(`ALTER TABLE ${ns}.observations ENABLE ROW LEVEL SECURITY`);
  await db.query(`ALTER TABLE ${ns}.observations FORCE ROW LEVEL SECURITY`);
  await db.query(`CREATE POLICY alt0810c20_scope ON ${ns}.observations TO ${role}
   USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer
   AND NULLIF(current_setting('app.user_id',true),'')::integer > 0)`);
  // Negative authz preflight MUST happen before SQL.
  assert.throws(()=>authorizeDisposableTenantScope({...scopedInput,
   principal:{...principal,verifiedSessionVersion:3}}),/SESSION_UNVERIFIED/);
  assert.throws(()=>authorizeDisposableTenantScope({...scopedInput,
   contract:{...contract,entitlementEnabled:false}}),/ENTITLEMENT_DENIED/);
  assert.throws(()=>authorizeDisposableTenantScope({...scopedInput,
   requestedTenantId:202}),/MEMBERSHIP_DENIED/);
  const authorized=authorizeDisposableTenantScope(scopedInput);
  await db.query('BEGIN');tx=true;
  try{
   await db.query(`SET LOCAL ROLE ${role}`);
   // Bind only server-authorized integer values in one transaction.
   await db.query('SELECT set_config($1,$2,true)',['app.tenant_id',String(authorized.tenantId)]);
   await db.query('SELECT set_config($1,$2,true)',['app.user_id',String(authorized.userId)]);
   const visible=(await db.query(`SELECT id FROM ${ns}.observations ORDER BY id`)).rows;
   assert.deepEqual(visible,[{id:1}]);
  }finally{await db.query('ROLLBACK');tx=false}
  const reset=await db.query('SELECT NULLIF(current_setting($1,true),$2) AS v',['app.tenant_id','']);
  assert.equal(reset.rows[0].v,null,'transaction leaked tenant context');
  const flags=await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1',[role]);
  assert.deepEqual(flags.rows,[{rolsuper:false,rolbypassrls:false}]);
  console.log('ALT0810C20: authorized and tenant-scoped PG16 transaction verified; no production authentication enabled');
 }finally{
  if(tx)await db.query('ROLLBACK').catch(()=>{});
  if(created){
   await db.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   await db.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await db.end();
 }
});
