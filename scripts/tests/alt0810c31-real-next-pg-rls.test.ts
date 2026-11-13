/**
 * ALT-08.10C.31: the EXISTING Next GET /api/me/permissions is called over
 * HTTP against disposable PostgreSQL16 with FORCE RLS on evidence.
 *
 * Inert fixture branch is inserted ONLY in disposable runner checkout. The
 * production source and deploy build NEVER contain this integration branch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {signSession,SESSION_COOKIE} from '../../lib/session';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
 e.ALT0810C31_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
 e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
 e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
 e.DATABASE_URL||e.RLS_DATABASE_URL||!e.RUNNER_TEMP||e.NODE_ENV==='production')
 throw Error('ALT0810C31_DISPOSABLE_ONLY');
type PgPort={connect():Promise<void>;query(q:string,p?:unknown[]):Promise<{rows:Record<string,unknown>[]}>;end():Promise<void>};
const {Client}=createRequire(import.meta.url)('pg') as {Client:new(o:Record<string,unknown>)=>PgPort};
const admin=new Client({host:'127.0.0.1',port:5432,
 database:'vigia_alt081_ci',user:'vigia_ci',password:'isolated_ci_only'});
const ns='alt0810c31_http',role='alt0810c31_reader';
const source=resolve('app/api/me/permissions/route.ts');
const original=readFileSync(source,'utf8');
const fixture=readFileSync(resolve('scripts/tests/fixtures/alt0810c31-permissions-branch.fixture.txt'),'utf8');
const marker='export async function GET(request: Request) {\n  try {';
const secret='ALT0810C31_Only_Disposable_Http_Session_2026';
const port=3231;
test('ALT-08.10C.31 existing HTTP business permissions route via real PG16 single-connection FORCE RLS',async()=>{
 assert.equal(original.includes('ALT0810C31_EPHEMERAL'),false,'refuse operational CI route branch');
 assert.equal(original.includes(marker),true,'real business handler changed unexpectedly');
 let created=false,patched=false;
 let child:ChildProcess|undefined;
 const logs:string[]=[];
 await admin.connect();
 try{
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS n',[ns])).rows[0].n,null);
  assert.equal((await admin.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[role])).rows.length,0);
  created=true;
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE`);
  await admin.query(`GRANT ${role} TO vigia_ci`);
  await admin.query(`CREATE SCHEMA ${ns}`);
  await admin.query(`SET search_path TO ${ns}`);
  await admin.query('CREATE TABLE users(id int primary key, session_version int NOT NULL, global_role text)');
  await admin.query('CREATE TABLE tenants(id int primary key, status text NOT NULL)');
  await admin.query('CREATE TABLE memberships(user_id int NOT NULL,tenant_id int NOT NULL,role text NOT NULL)');
  await admin.query('CREATE TABLE subscriptions(id serial primary key,tenant_id int,plan_key text,status text,vigencia_ate timestamptz,grace_until timestamptz)');
  await admin.query('CREATE TABLE tenant_features(tenant_id int,feature_key text,enabled int,expires_at timestamptz)');
  await admin.query('CREATE TABLE plan_features(plan_key text,feature_key text)');
  await admin.query('CREATE TABLE evidence(id int primary key,tenant_id int NOT NULL)');
  await admin.query("INSERT INTO users VALUES(1001,0,NULL),(2002,0,NULL),(9001,0,'owner')");
  await admin.query("INSERT INTO tenants VALUES(101,'active'),(202,'active')");
  await admin.query("INSERT INTO memberships VALUES(1001,101,'client_viewer'),(2002,202,'client_admin')");
  await admin.query("INSERT INTO subscriptions(tenant_id,plan_key,status) VALUES(101,'ci31','active'),(202,'ci31','active')");
  await admin.query("INSERT INTO plan_features VALUES('ci31','reports_weekly')");
  await admin.query("INSERT INTO evidence VALUES(1,101),(2,202)");
  await admin.query(`GRANT USAGE ON SCHEMA ${ns} TO ${role}`);
  await admin.query(`GRANT SELECT ON ${ns}.evidence TO ${role}`);
  await admin.query('ALTER TABLE evidence ENABLE ROW LEVEL SECURITY');
  await admin.query('ALTER TABLE evidence FORCE ROW LEVEL SECURITY');
  await admin.query(`CREATE POLICY ci31_evidence ON evidence FOR SELECT TO ${role}
    USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::int
      AND NULLIF(current_setting('app.user_id',true),'')::int>0)`);
  writeFileSync(source,original.replace(marker,marker+'\n'+fixture));patched=true;
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1',
   '--port',String(port)],{
   cwd:process.cwd(),env:{...e,SESSION_SECRET:secret,ALT0810C31_EPHEMERAL:'1',
    DATABASE_URL:'',RLS_DATABASE_URL:'',DEMO_MODE:'0',NEXT_TELEMETRY_DISABLED:'1'},
   stdio:['ignore','pipe','pipe']
  });
  child.stdout?.on('data',(x:Buffer)=>logs.push(String(x).slice(-1000)));
  child.stderr?.on('data',(x:Buffer)=>logs.push(String(x).slice(-1000)));
  type Reply={status:number;body:{permissions?:{tenantId?:number};features?:string[];scopedEvidenceIds?:number[];error?:string}};
  async function request(id?:number,version=0,spoof?:number):Promise<Reply>{
   const uri=`http://127.0.0.1:${port}/api/me/permissions`+
     (spoof?`?tenant_id=${spoof}&surface=app`:'');
   const response=await fetch(uri,{headers:id?{cookie:`${SESSION_COOKIE}=${signSession(id,version)}`}:{},
    redirect:'manual',signal:AbortSignal.timeout(12000)});
   return {status:response.status,body:await response.json().catch(()=>({}))};
  }
  let ready=false,last='';
  for(let i=0;i<55;i++){
   if(child.exitCode!==null)break;
   try{const resp=await request(1001);last=JSON.stringify(resp);if(resp.status===200){ready=true;break}}
   catch(err){last=String(err)}
   await delay(900);
  }
  assert.equal(ready,true,'Next route startup: '+last+' logs '+logs.slice(-7).join('').slice(-2500));
  const a=await request(1001),b=await request(2002);
  assert.deepEqual({status:a.status,tenant:a.body.permissions?.tenantId,ids:a.body.scopedEvidenceIds},
   {status:200,tenant:101,ids:[1]});
  assert.deepEqual({status:b.status,tenant:b.body.permissions?.tenantId,ids:b.body.scopedEvidenceIds},
   {status:200,tenant:202,ids:[2]});
  const forged=await request(1001,0,202);
  assert.equal(forged.status,200);
  assert.deepEqual(forged.body.scopedEvidenceIds,[1],'client input cannot switch tenant');
  assert.equal((await request()).status,401);
  assert.equal((await request(9001)).status,403);
  await admin.query("INSERT INTO tenant_features VALUES(101,'reports_weekly',0,NULL)");
  assert.equal((await request(1001)).status,403,'contract override denies');
  assert.deepEqual((await request(2002)).body.scopedEvidenceIds,[2]);
  await admin.query("DELETE FROM tenant_features WHERE tenant_id=101");
  await admin.query("UPDATE subscriptions SET status='suspended' WHERE tenant_id=101");
  assert.equal((await request(1001)).status,403,'subscription denies');
  await admin.query("UPDATE subscriptions SET status='active' WHERE tenant_id=101");
  await admin.query('UPDATE users SET session_version=1 WHERE id=1001');
  assert.equal((await request(1001)).status,401,'revoked session denies');
  assert.deepEqual((await request(1001,1)).body.scopedEvidenceIds,[1]);
  const inspect=await admin.query(`SELECT rolbypassrls FROM pg_roles WHERE rolname=$1`,[role]);
  assert.equal(inspect.rows[0].rolbypassrls,false);
  console.log('ALT0810C31 real Next route HTTP PG16: A=[1] B=[2], forged tenant ignored, session/contract/entitlement denied, FORCE RLS positive; ephemeral injection only, production NO-GO');
 }finally{
  if(child&&child.exitCode===null){
   child.kill('SIGTERM');for(let i=0;i<20&&child.exitCode===null;i++)await delay(150);
   if(child.exitCode===null)child.kill('SIGKILL');
  }
  if(patched)writeFileSync(source,original);
  if(created){
   await admin.query('SET search_path TO public').catch(()=>{});
   await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await admin.end();
 }
});
