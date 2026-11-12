/**
 * ALT-08.10: real Next.js /api/app/evidence end-to-end in isolated Neon
 * staging with same DB and reader for auth, entitlement and RLS.
 * Synthetic namespace; owner migrator for fixture creation/teardown ONLY.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {signSession,SESSION_COOKIE} from '../../lib/session';
import {withNeonRlsPool} from '../../lib/tenant/neon-rls-adapter';
import type {TenantSqlPool,TenantSqlClient} from '../../lib/tenant/rls-transaction';

const e=process.env;
const NS='alt0810_next_ci',DB='vigia_alt086_staging_20261112';
const READ='vigia_alt087_staging_reader',OWNER='vigia_alt083_ci_20261112_owner';
type Q=TenantSqlClient['query'];
function target(value:string|undefined,role:string):string{
 if(!value)throw Error('ALT0810_MISSING_SECRET');
 const u=new URL(value);
 if(!['postgres:','postgresql:'].includes(u.protocol)||
   !u.hostname.endsWith('.neon.tech')||
   decodeURIComponent(u.pathname.slice(1))!==DB||
   decodeURIComponent(u.username)!==role)throw Error('ALT0810_WRONG_TARGET');
 return u.hostname;
}
function guard(){
 if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.NODE_ENV==='production'||
  e.DATABASE_URL||e.VIGIA_RLS_MODE!=='ci-experimental'||
  e.VIGIA_ALT0810_NEXT_STAGING_MODE!=='isolated-next-auth'||
  e.ALT0810_STAGING_CONFIRM!=='NEXT_REAL_ROUTE_SYNTHETIC_ONLY'||
  !e.RUNNER_TEMP||!e.GITHUB_RUN_ID||
  !/^\d+$/.test(e.GITHUB_RUN_ID))throw Error('ALT0810_CI_ONLY');
 assert.equal(target(e.RLS_DATABASE_URL,READ),target(e.ALT087_STAGING_MIGRATOR_URL,OWNER));
}
async function catalog(q:Q){
 const r=await q(`SELECT
  (SELECT count(*)::int FROM pg_namespace WHERE nspname='${NS}') AS s,
  (SELECT count(*)::int FROM pg_tables WHERE schemaname='${NS}') AS t,
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='${NS}') AS p`);
 return [Number(r.rows[0].s),Number(r.rows[0].t),Number(r.rows[0].p)];
}
async function prepare(pool:TenantSqlPool){
 const c=await pool.connect();
 try{
  const info=await c.query('SELECT current_database() AS db,current_user AS role');
  assert.equal(info.rows[0].db,DB);assert.equal(info.rows[0].role,OWNER);
  assert.deepEqual(await catalog(c.query.bind(c)),[0,0,0]);
  await c.query('BEGIN');
  try{
   const cmds=[
    `CREATE SCHEMA ${NS}`,
    `CREATE TABLE ${NS}.users(id integer PRIMARY KEY,global_role text,
      session_version integer NOT NULL,must_change_password integer NOT NULL)`,
    `CREATE TABLE ${NS}.tenants(id integer PRIMARY KEY,status text NOT NULL)`,
    `CREATE TABLE ${NS}.memberships(user_id integer NOT NULL,tenant_id integer NOT NULL,role text NOT NULL)`,
    `CREATE TABLE ${NS}.plans(key text PRIMARY KEY)`,
    `CREATE TABLE ${NS}.plan_features(plan_key text,feature_key text)`,
    `CREATE TABLE ${NS}.subscriptions(tenant_id integer,plan_key text,status text,
      vigencia_ate timestamptz)`,
    `CREATE TABLE ${NS}.tenant_features(tenant_id integer,feature_key text,enabled integer)`,
    `CREATE TABLE ${NS}.incidents(id integer PRIMARY KEY,tenant_id integer NOT NULL,
      title text NOT NULL,private_payload text NOT NULL)`,
    `INSERT INTO ${NS}.users VALUES
       (101,NULL,0,0),(102,NULL,0,0),(103,NULL,0,0),
       (104,'owner',0,0),(105,'analyst',0,0),(106,NULL,0,1),
       (107,NULL,0,0)`,
    `INSERT INTO ${NS}.tenants VALUES(771,'active'),(882,'active')`,
    `INSERT INTO ${NS}.memberships VALUES
       (101,771,'client_admin'),(102,882,'client_viewer'),
       (103,771,'client_viewer'),(106,771,'client_viewer'),
       (107,771,'client_viewer'),(107,882,'client_viewer')`,
    `INSERT INTO ${NS}.plans VALUES('trial')`,
    `INSERT INTO ${NS}.plan_features VALUES('trial','reputation_dual')`,
    `INSERT INTO ${NS}.subscriptions VALUES
       (771,'trial','active',NULL),(882,'trial','active',NULL)`,
    `INSERT INTO ${NS}.incidents VALUES
       (1001,771,'ALT0810_A','private-A'),(2002,882,'ALT0810_B','private-B')`,
    `GRANT USAGE ON SCHEMA ${NS} TO ${READ}`,
    `GRANT SELECT(id,global_role,session_version,must_change_password)
       ON ${NS}.users TO ${READ}`,
    `GRANT SELECT(user_id,tenant_id,role) ON ${NS}.memberships TO ${READ}`,
    `GRANT SELECT(id,status) ON ${NS}.tenants TO ${READ}`,
    `GRANT SELECT(tenant_id,plan_key,status,vigencia_ate)
       ON ${NS}.subscriptions TO ${READ}`,
    `GRANT SELECT(plan_key,feature_key) ON ${NS}.plan_features TO ${READ}`,
    `GRANT SELECT(tenant_id,feature_key,enabled) ON ${NS}.tenant_features TO ${READ}`,
    `GRANT SELECT(id,title) ON ${NS}.incidents TO ${READ}`,
    `ALTER TABLE ${NS}.incidents ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${NS}.incidents FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY alt0810_read ON ${NS}.incidents AS PERMISSIVE
       FOR SELECT TO ${READ}
       USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer)`
   ];
   for(const sql of cmds)await c.query(sql);
   await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error}
  assert.deepEqual(await catalog(c.query.bind(c)),[1,9,1]);
 }finally{c.release()}
}
async function cleanup(pool:TenantSqlPool){
 const c=await pool.connect();
 try{
  assert.deepEqual(await catalog(c.query.bind(c)),[1,9,1],'unexpected changes in reserved schema');
  await c.query('BEGIN');
  try{
   const cmds=[
    `DROP POLICY alt0810_read ON ${NS}.incidents`,
    `ALTER TABLE ${NS}.incidents NO FORCE ROW LEVEL SECURITY`,
    `ALTER TABLE ${NS}.incidents DISABLE ROW LEVEL SECURITY`,
    `REVOKE SELECT(id,title) ON ${NS}.incidents FROM ${READ}`,
    `REVOKE SELECT(tenant_id,feature_key,enabled) ON ${NS}.tenant_features FROM ${READ}`,
    `REVOKE SELECT(plan_key,feature_key) ON ${NS}.plan_features FROM ${READ}`,
    `REVOKE SELECT(tenant_id,plan_key,status,vigencia_ate) ON ${NS}.subscriptions FROM ${READ}`,
    `REVOKE SELECT(id,status) ON ${NS}.tenants FROM ${READ}`,
    `REVOKE SELECT(user_id,tenant_id,role) ON ${NS}.memberships FROM ${READ}`,
    `REVOKE SELECT(id,global_role,session_version,must_change_password) ON ${NS}.users FROM ${READ}`,
    `REVOKE USAGE ON SCHEMA ${NS} FROM ${READ}`,
    ...['incidents','tenant_features','subscriptions','plan_features','plans',
       'memberships','tenants','users'].map(t=>`DROP TABLE ${NS}.${t}`),
    `DROP SCHEMA ${NS}`
   ];
   for(const sql of cmds)await c.query(sql);
   await c.query('COMMIT');
  }catch(err){await c.query('ROLLBACK');throw err}
  assert.deepEqual(await catalog(c.query.bind(c)),[0,0,0]);
  console.log('ALT0810 NEXT: isolated staging schema rollback 0/0/0 VERIFIED');
 }finally{c.release()}
}
async function runHttp(owner:TenantSqlPool){
 const port=3187;
 // Internal app, not a public site. Child receives only reader URL, no migrator secret.
 const nextEnv={...e,ALT087_STAGING_MIGRATOR_URL:'',
  PORT:String(port),NEXT_TELEMETRY_DISABLED:'1',DEMO_MODE:'0',
  SESSION_SECRET:'ALT0810_HARNESS_Strong_Only_For_CI_2026'};
 const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev',
     '--hostname','127.0.0.1','--port',String(port)],
    {env:nextEnv,stdio:['ignore','pipe','pipe']});
 let lines='';
 const capture=(chunk:Buffer)=>{lines=(lines+chunk.toString()).slice(-3500)};
 child.stdout?.on('data',capture);child.stderr?.on('data',capture);
 const origin=`http://127.0.0.1:${port}`;
 const cookie=(id:number,version=0)=>signSession(id,version);
 async function req(id?:number,version=0,query='',override?:string){
  const v=override??(id?cookie(id,version):null);
  const response=await fetch(origin+'/api/app/evidence'+query,{
    headers:v?{cookie:`${SESSION_COOKIE}=${v}`}:{},
    redirect:'manual',signal:AbortSignal.timeout(25000)});
  return {status:response.status,body:await response.text()};
 }
 async function mutate(sql:string){
  const c=await owner.connect();
  try{await c.query(sql)}finally{c.release()}
 }
 try{
  let live=false;
  for(let attempt=0;attempt<50;attempt++){
   if(child.exitCode!==null)throw Error('ALT0810_NEXT_EXITED '+lines);
   try{
    const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1500)});
    if(r.ok){live=true;break}
   }catch{/* start */}
   await new Promise(r=>setTimeout(r,1000));
  }
  assert.equal(live,true,'Next did not boot: '+lines);
  assert.equal((await req()).status,401);
  assert.equal((await req(undefined,0,'','forged')).status,401);
  const a=await req(101,0,'?tenant_id=882');
  assert.equal(a.status,200,'A HTTP auth '+a.body.slice(0,300));
  assert.equal(JSON.parse(a.body).tenantId,771);
  assert.deepEqual(JSON.parse(a.body).items.map((x:{id:number})=>x.id),[1001]);
  const b=await req(102,0,'?tenant_id=771');
  assert.equal(b.status,200,'B HTTP auth '+b.body.slice(0,300));
  assert.equal(JSON.parse(b.body).tenantId,882);
  assert.deepEqual(JSON.parse(b.body).items.map((x:{id:number})=>x.id),[2002]);
  assert.equal((await req(104)).status,403,'owner cannot use client RLS reader');
  assert.equal((await req(105)).status,403,'analyst cannot use client RLS reader');
  assert.equal((await req(106)).status,401,'must change password blocked');
  assert.equal((await req(107)).status,403,'multiple membership ambiguous');
  assert.equal((await req(107,0,'?tenant_id=882')).status,200);
  await mutate(`DELETE FROM ${NS}.memberships WHERE user_id=103`);
  assert.equal((await req(103)).status,403,'revoked membership denies');
  await mutate(`UPDATE ${NS}.users SET session_version=1 WHERE id=101`);
  assert.equal((await req(101)).status,401,'old signed cookie revoked');
  assert.equal((await req(101,1)).status,200,'new version authorized');
  await mutate(`INSERT INTO ${NS}.tenant_features VALUES
    (771,'reputation_dual',0)`);
  assert.equal((await req(101,1)).status,403,'denied feature revokes access');
  assert.equal((await req(102)).status,200,'B unaffected by A revocation');
  await mutate(`UPDATE ${NS}.subscriptions SET status='canceled' WHERE tenant_id=882`);
  assert.equal((await req(102)).status,403,'canceled contract denies');
  console.log('ALT0810 NEXT: REAL Next HTTP route, same Neon staging reader auth+entitlements+RLS, session/membership/plan revocation VERIFIED');
 }finally{
  child.kill('SIGTERM');
  await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,6000))]);
  if(child.exitCode===null)child.kill('SIGKILL');
 }
}
async function main(){
 guard();
 const ownerEnv={...e,RLS_DATABASE_URL:e.ALT087_STAGING_MIGRATOR_URL};
 await withNeonRlsPool(ownerEnv,async owner=>{
  let created=false;
  try{
   await prepare(owner);created=true;
   await runHttp(owner);
  }finally{if(created)await cleanup(owner)}
 });
}
main().catch(err=>{
 console.error('ALT0810 NEXT NO-GO:',err instanceof Error?err.message:'unknown');
 process.exitCode=1;
});
