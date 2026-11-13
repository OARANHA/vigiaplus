/**
 * ALT-08.10C.25 end-to-end: actual Next.js route + actual ephemeral
 * PostgreSQL16 on SAME DB connection for session+membership+RLS.
 * Runs in GitHub CI with local postgres:16 only. No Neon or staging.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {signSession,SESSION_COOKIE} from '../../lib/session';
import {assertAlt0810c24Env,CI_SCHEMA,CI_READER,newDisposableClient}
 from '../../lib/db/alt0810c24-disposable-pg-adapter';

assertAlt0810c24Env(process.env);
if(process.env.ALT0810C25_EPHEMERAL!=='1'||!process.env.RUNNER_TEMP||
 process.env.NEXT_RUNTIME||process.env.DATABASE_URL||process.env.RLS_DATABASE_URL)
 throw Error('ALT0810C25_DISPOSABLE_NEXT_PG_ONLY');
const ns=CI_SCHEMA,role=CI_READER,port=3205;
const admin=newDisposableClient(process.env);
const origin=`http://127.0.0.1:${port}/api/ci/alt0810c25`;
test('ALT-08.10C.25 Next.js handler+PG16 same-transaction authorization and revocation',async()=>{
 await admin.connect();let created=false;let child:ChildProcess|undefined;
 try{
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS ns',[ns])).rows[0].ns,null);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0);
  created=true;
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await admin.query(`CREATE SCHEMA ${ns}`);
  await admin.query(`CREATE TABLE ${ns}.users(id int PRIMARY KEY,session_version int NOT NULL,global_role text)`);
  await admin.query(`CREATE TABLE ${ns}.memberships(user_id int NOT NULL,tenant_id int NOT NULL,
   role text NOT NULL,active boolean NOT NULL,PRIMARY KEY(user_id,tenant_id))`);
  await admin.query(`CREATE TABLE ${ns}.contracts(tenant_id int PRIMARY KEY,
   status text NOT NULL,subscription_status text NOT NULL,
   entitlement_enabled boolean NOT NULL)`);
  await admin.query(`CREATE TABLE ${ns}.evidence(id int PRIMARY KEY,tenant_id int NOT NULL)`);
  await admin.query(`INSERT INTO ${ns}.users VALUES(1001,0,NULL),(2002,0,NULL),(9001,0,'owner')`);
  await admin.query(`INSERT INTO ${ns}.memberships VALUES
   (1001,101,'client_viewer',true),(2002,202,'client_admin',true)`);
  await admin.query(`INSERT INTO ${ns}.contracts VALUES
   (101,'active','active',true),(202,'active','active',true)`);
  await admin.query(`INSERT INTO ${ns}.evidence VALUES(1,101),(2,202)`);
  await admin.query(`GRANT USAGE ON SCHEMA ${ns} TO ${role}`);
  await admin.query(`GRANT SELECT ON ${ns}.evidence TO ${role}`);
  await admin.query(`ALTER TABLE ${ns}.evidence ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE ${ns}.evidence FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY alt0810c25_tenant ON ${ns}.evidence TO ${role}
   USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer
    AND NULLIF(current_setting('app.user_id',true),'')::integer>0)`);
  const logs:string[]=[];
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev',
   '--hostname','127.0.0.1','--port',String(port)],{
    cwd:process.cwd(),env:{...process.env,
     NEXT_TELEMETRY_DISABLED:'1',DEMO_MODE:'0',DATABASE_URL:'',
     RLS_DATABASE_URL:'',ALT0810C24_EPHEMERAL:'1',
     ALT0810C25_EPHEMERAL:'1'},
    stdio:['ignore','pipe','pipe'],
  });
  child.stdout?.on('data',(b:Buffer)=>{logs.push(String(b).slice(-800))});
  child.stderr?.on('data',(b:Buffer)=>{logs.push(String(b).slice(-800))});
  let ready=false;
  for(let n=0;n<75;n++){
   if(child.exitCode!==null)break;
   try{
    const r=await fetch(origin+'?tenant=101',{
     headers:{Cookie:`${SESSION_COOKIE}=${signSession(1001,0)}`},
     signal:AbortSignal.timeout(2200)});
    if(r.status===200){ready=true;break}
   }catch{/* starting */}
   await delay(1100);
  }
  assert.equal(ready,true,'Next.js CI PostgreSQL handler not ready: '+logs.slice(-8).join('').slice(-2400));
  const request=async(id:number|undefined,tenant:number,version=0,rawCookie?:string)=>{
   const response=await fetch(origin+'?tenant='+tenant,{
    headers:id?{Cookie:`${SESSION_COOKIE}=${rawCookie??signSession(id,version)}`}:{},
    redirect:'manual',signal:AbortSignal.timeout(15000)});
   return {status:response.status,body:await response.json() as {ids?:number[];error?:string},
    cache:response.headers.get('cache-control')};
  };
  const a=await request(1001,101),b=await request(2002,202);
  assert.equal(a.status,200);assert.deepEqual(a.body.ids,[1]);
  assert.equal(b.status,200);assert.deepEqual(b.body.ids,[2]);
  assert.equal(a.cache,'no-store');
  assert.equal((await request(1001,202)).status,403);
  assert.equal((await request(2002,101)).status,403);
  assert.equal((await request(9001,101)).status,403);
  assert.equal((await request(1001,101,0,'1001.0.'+'0'.repeat(64))).status,401);
  assert.equal((await request(undefined,101)).status,401);
  await admin.query(`UPDATE ${ns}.memberships SET active=false WHERE user_id=1001`);
  assert.equal((await request(1001,101)).status,403);
  await admin.query(`UPDATE ${ns}.memberships SET active=true WHERE user_id=1001`);
  await admin.query(`UPDATE ${ns}.contracts SET entitlement_enabled=false WHERE tenant_id=101`);
  assert.equal((await request(1001,101)).status,403);
  await admin.query(`UPDATE ${ns}.contracts SET entitlement_enabled=true WHERE tenant_id=101`);
  await admin.query(`UPDATE ${ns}.users SET session_version=1 WHERE id=1001`);
  assert.equal((await request(1001,101)).status,401);
  assert.equal((await request(1001,101,1)).status,200);
  assert.deepEqual((await request(2002,202)).body.ids,[2]);
  console.log('ALT0810C25: Next.js real App Router -> signed session, memberships, contract, FORCE RLS in one disposable PostgreSQL16 transaction; NO-GO operational');
 }finally{
  if(child&&child.exitCode===null){
   child.kill('SIGTERM');
   for(let n=0;n<12&&child.exitCode===null;n++)await delay(300);
   if(child.exitCode===null)child.kill('SIGKILL');
  }
  if(created){
   await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await admin.end();
 }
});
