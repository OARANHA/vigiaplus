/**
 * ALT-08.10C.29 — Existing /api/me/permissions route against real disposable
 * PostgreSQL16. This DOES NOT authorize production RLS: isolated CI Drizzle
 * transport is injected into an ephemeral checkout, never committed to app.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {extractStaticBootstrapDdl} from '../../lib/db/bootstrap-snapshot';
import {signSession,SESSION_COOKIE} from '../../lib/session';
import {FEATURE_KEYS} from '../../lib/tenant/catalog';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
 e.ALT0810C29_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
 e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
 e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
 e.DATABASE_URL||e.RLS_DATABASE_URL||!e.RUNNER_TEMP||e.NODE_ENV==='production')
 throw Error('ALT0810C29_DISPOSABLE_ONLY');
const root=process.cwd(),ns='alt0810c29_real_route',port=3229;
const dbPath=resolve(root,'lib/db/index.ts');
const adapterFixture=resolve(root,'scripts/tests/fixtures/alt0810c29-db.fixture.txt');
const original=readFileSync(dbPath,'utf8');
assert.equal(existsSync(adapterFixture),true);
const {Client}=createRequire(import.meta.url)('pg') as {Client:new(options:Record<string,unknown>)=>any};
const db=new Client({host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
 user:'vigia_ci',password:'isolated_ci_only'});
const secret='ALT0810C29_Disposable_Signed_Cookie_2026_Only';
const origin=`http://127.0.0.1:${port}/api/me/permissions`;
test('ALT-08.10C.29 real business route: signed sessions, tenant membership, entitlements and RLS diagnostic',async()=>{
 await db.connect();let created=false,patched=false;let child:ChildProcess|undefined;
 const logs:string[]=[];
 try{
  assert.equal((await db.query('SELECT to_regnamespace($1) AS name',[ns])).rows[0].name,null);
  created=true;
  await db.query(`CREATE SCHEMA ${ns}`);
  await db.query(`SET search_path TO ${ns}`);
  const ddl=extractStaticBootstrapDdl(original);
  assert.equal(ddl.length,186);
  for(let i=0;i<ddl.length;i++){
   try{await db.query(ddl[i])}
   catch(err){throw Error('ALT0810C29_SCHEMA_DDL_'+(i+1)+':'+String(err))}
  }
  await db.query(`INSERT INTO users(id,name,email,password_hash,global_role,must_change_password,session_version)
    VALUES(1001,'Client A','a@ci.invalid','not-real',NULL,0,0),
          (2002,'Client B','b@ci.invalid','not-real',NULL,0,0)`);
  await db.query(`INSERT INTO tenants(id,name,slug,status,plan_key)
    VALUES(101,'Tenant A','tenant-a-ci','active','ci29'),
          (202,'Tenant B','tenant-b-ci','active','ci29')`);
  await db.query(`INSERT INTO memberships(user_id,tenant_id,role)
    VALUES(1001,101,'client_viewer'),(2002,202,'client_admin')`);
  await db.query(`INSERT INTO plans(key,label) VALUES('ci29','CI Only')`);
  const feature=Array.from(FEATURE_KEYS)[0];
  assert.ok(feature,'a commercial feature must exist');
  await db.query('INSERT INTO plan_features(plan_key,feature_key) VALUES($1,$2)',['ci29',feature]);
  await db.query(`INSERT INTO subscriptions(tenant_id,plan_key,status)
    VALUES(101,'ci29','active'),(202,'ci29','active')`);

  // Inject adapter ONLY in the disposable runner's checkout, then restore.
  assert.match(original,/export function getDb\(/);
  writeFileSync(dbPath,readFileSync(adapterFixture,'utf8'));patched=true;
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev',
    '--hostname','127.0.0.1','--port',String(port)],{
    cwd:root,
    env:{...e,ALT0810C29_SCHEMA:ns,SESSION_SECRET:secret,
      DATABASE_URL:'',RLS_DATABASE_URL:'',DEMO_MODE:'0',
      NEXT_TELEMETRY_DISABLED:'1'},
    stdio:['ignore','pipe','pipe'],
  });
  child.stdout?.on('data',(b:Buffer)=>logs.push(String(b).slice(-900)));
  child.stderr?.on('data',(b:Buffer)=>logs.push(String(b).slice(-900)));
  async function request(id:number|undefined,version=0,tenant?:number){
   const u=origin+(tenant?`?surface=app&tenant_id=${tenant}`:'');
   const response=await fetch(u,{
    headers:id?{cookie:`${SESSION_COOKIE}=${signSession(id,version)}`}:{},
    redirect:'manual',signal:AbortSignal.timeout(15000)});
   const body=await response.json().catch(()=>({}));
   return {status:response.status,body:body as Record<string,any>};
  }
  let ready=false;
  for(let i=0;i<70;i++){
   if(child.exitCode!==null)break;
   try{const a=await request(1001);if(a.status===200){ready=true;break}}
   catch{/* startup */}
   await delay(850);
  }
  assert.equal(ready,true,'real Next route failed startup: '+logs.slice(-8).join('').slice(-2500));
  const a=await request(1001),b=await request(2002);
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal(a.body.permissions.tenantId,101);
  assert.equal(b.body.permissions.tenantId,202);
  assert.ok(a.body.features.includes(feature),'commercial plan feature A');
  assert.ok(b.body.features.includes(feature),'commercial plan feature B');
  const spoof=await request(1001,0,202);
  assert.equal(spoof.status,200);
  assert.equal(spoof.body.permissions.tenantId,101,'forged tenant query must be ignored');
  assert.equal((await request(undefined)).status,401);
  await db.query(`INSERT INTO tenant_features(tenant_id,feature_key,enabled,reason)
    VALUES(101,$1,0,'CI revoked')`,[feature]);
  const revokedFeature=await request(1001);
  assert.equal(revokedFeature.status,200);
  assert.equal(revokedFeature.body.features.includes(feature),false,
    'tenant A disabled override must win');
  assert.equal((await request(2002)).body.features.includes(feature),true,
    'tenant B still has its contracted feature');
  await db.query('UPDATE users SET session_version=1 WHERE id=1001');
  assert.equal((await request(1001)).status,401);
  assert.equal((await request(1001,1)).status,200);
  // Existing route currently does not bind a transaction-local tenant identity.
  // Show that FORCE RLS cannot yield the original client entitlement read.
  await db.query(`ALTER TABLE ${ns}.tenants ENABLE ROW LEVEL SECURITY`);
  await db.query(`ALTER TABLE ${ns}.tenants FORCE ROW LEVEL SECURITY`);
  await db.query(`CREATE POLICY ci29_deny_without_scope ON ${ns}.tenants
    FOR SELECT USING (id=COALESCE(NULLIF(current_setting('app.tenant_id',true),''),'0')::integer)`);
  const rls=await request(2002);
  assert.equal(rls.status,200);
  assert.equal(rls.body.features.includes(feature),false,
    'without authenticated transaction-local tenant GUC, RLS must fail closed');
  console.log('ALT0810C29 real business route: auth/membership/entitlement positive; spoof and revoke denied; FORCE RLS fails closed without scoped transaction. OPERATIONAL RLS NO-GO');
 }finally{
  if(child&&child.exitCode===null){
   child.kill('SIGTERM');
   for(let i=0;i<18&&child.exitCode===null;i++)await delay(150);
   if(child.exitCode===null)child.kill('SIGKILL');
  }
  if(patched)writeFileSync(dbPath,original);
  if(created){
   await db.query('SET search_path TO public').catch(()=>{});
   await db.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
  }
  await db.end().catch(()=>{});
 }
});
