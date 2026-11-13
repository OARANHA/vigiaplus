/**
 * ALT-08.10C.21 — HTTP -> signed cookie -> database session, membership
 * and entitlement, checked in the SAME transaction as restricted RLS read.
 *
 * Disposable CI fixture only. NOT a Next.js operational route, deployable
 * server, Neon connection, or production authentication implementation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {authorizeDisposableTenantScope} from '../../lib/tenant/alt0810c20-authz-preflight';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
 e.ALT0810C21_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
 e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
 e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
 e.DATABASE_URL||e.RLS_DATABASE_URL||e.NODE_ENV==='production')
 throw Error('ALT0810C21_DISPOSABLE_PG16_ONLY');

type Rows={rows:Record<string,unknown>[];rowCount:number|null};
type DB={connect():Promise<void>;query(sql:string,params?:unknown[]):Promise<Rows>;end():Promise<void>};
const {Client}=createRequire(import.meta.url)('pg') as {Client:new(config:Record<string,unknown>)=>DB};
const conn={host:'127.0.0.1',port:5432,user:'vigia_ci',password:'isolated_ci_only',
 database:'vigia_alt081_ci'};
const admin=new Client(conn);
const ns='alt0810c6_http21';
const reader='alt0810c6_http_reader21';
const key='ci-ephemeral-hmac-fixture-only-not-for-operations';
const cookieValue=(sid:string)=>sid+'.'+createHmac('sha256',key).update(sid).digest('hex');
function verifyCookie(value:string|undefined):string|null{
 if(!value)return null;
 const match=/^(s[0-9]+)\.([a-f0-9]{64})$/.exec(value);
 if(!match)return null;
 const expected=createHmac('sha256',key).update(match[1]).digest();
 const actual=Buffer.from(match[2],'hex');
 return expected.length===actual.length&&timingSafeEqual(expected,actual)?match[1]:null;
}
const getCookie=(header:string|undefined)=>{
 const part=header?.split(';').map(x=>x.trim()).find(x=>x.startsWith('vigia_session='));
 return part?.slice('vigia_session='.length);
};
const newDb=()=>new Client(conn);
async function authorizeAndRead(sessionId:string,tenantId:number):Promise<{
 status:number;ids?:number[];
}>{
 const db=newDb();
 await db.connect();
 let tx=false;
 try{
  await db.query('BEGIN');tx=true;
  const sessions=await db.query(`SELECT user_id,version,verified_version,active
    FROM ${ns}.sessions WHERE id=$1 FOR SHARE`,[sessionId]);
  const session=sessions.rows[0];
  if(!session||session.active!==true||session.version!==session.verified_version)
   return {status:401};
  const linked=await db.query(`SELECT m.user_id,m.tenant_id,m.role,m.active,
    t.status, t.subscription_status,t.entitlement_enabled
    FROM ${ns}.memberships m JOIN ${ns}.contracts t ON t.tenant_id=m.tenant_id
    WHERE m.user_id=$1 AND m.tenant_id=$2 FOR SHARE OF m,t`,
    [session.user_id,tenantId]);
  const item=linked.rows[0];
  try{
   authorizeDisposableTenantScope({
    principal:{userId:Number(session.user_id),sessionVersion:Number(session.version),
      verifiedSessionVersion:Number(session.verified_version),globalRole:'client'},
    requestedTenantId:tenantId,
    membership:item?{userId:Number(item.user_id),tenantId:Number(item.tenant_id),
      role:String(item.role) as 'client_viewer'|'client_admin',active:item.active===true}:null,
    contract:item?{tenantId:Number(item.tenant_id),
      status:String(item.status) as 'active'|'pending'|'suspended',
      subscriptionStatus:String(item.subscription_status) as 'active'|'past_due'|'suspended'|'none',
      entitlementEnabled:item.entitlement_enabled===true}:null,
   });
  }catch{return {status:403}}
  await db.query(`SET LOCAL ROLE ${reader}`);
  await db.query('SELECT set_config($1,$2,true)',['app.user_id',String(session.user_id)]);
  await db.query('SELECT set_config($1,$2,true)',['app.tenant_id',String(tenantId)]);
  const result=await db.query(`SELECT id FROM ${ns}.evidence ORDER BY id`);
  return {status:200,ids:result.rows.map(x=>Number(x.id))};
 }finally{
  if(tx)await db.query('ROLLBACK').catch(()=>{});
  await db.end();
 }
}
test('ALT-08.10C.21: real loopback HTTP with DB-authorized RLS and revocation',async()=>{
 await admin.connect();
 let created=false;
 const server=createServer((req,res)=>{
  void (async()=>{
   const send=(status:number,body:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
   if(req.method!=='GET')return send(405,{error:'method'});
   const url=new URL(req.url??'/', 'http://127.0.0.1');
   if(url.pathname!=='/observations')return send(404,{error:'not_found'});
   const id=verifyCookie(getCookie(req.headers.cookie));
   if(!id)return send(401,{error:'session'});
   const raw=url.searchParams.get('tenant');
   if(!raw||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<=0)
    return send(400,{error:'tenant'});
   const response=await authorizeAndRead(id,Number(raw));
   return send(response.status,response.status===200?{ids:response.ids}:{error:'denied'});
  })().catch(()=>{if(!res.headersSent){res.writeHead(500);res.end('error')}})
 });
 let serverListening=false;
 try{
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS n',[ns])).rows[0].n,null);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1',[reader])).rows[0].n,0);
  created=true;
  await admin.query(`CREATE ROLE ${reader} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
  await admin.query(`CREATE SCHEMA ${ns}`);
  await admin.query(`CREATE TABLE ${ns}.sessions(
   id text PRIMARY KEY,user_id int NOT NULL,version int NOT NULL,
   verified_version int NOT NULL,active boolean NOT NULL)`);
  await admin.query(`CREATE TABLE ${ns}.memberships(
   user_id int NOT NULL,tenant_id int NOT NULL,role text NOT NULL,active boolean NOT NULL,
   PRIMARY KEY(user_id,tenant_id))`);
  await admin.query(`CREATE TABLE ${ns}.contracts(
   tenant_id int PRIMARY KEY,status text NOT NULL,subscription_status text NOT NULL,
   entitlement_enabled boolean NOT NULL)`);
  await admin.query(`CREATE TABLE ${ns}.evidence(id int PRIMARY KEY,tenant_id int NOT NULL)`);
  await admin.query(`INSERT INTO ${ns}.sessions VALUES
   ('s1',1001,4,4,true),('s2',2002,1,1,true),('s3',1003,1,1,false)`);
  await admin.query(`INSERT INTO ${ns}.memberships VALUES
   (1001,101,'client_viewer',true),(2002,202,'client_admin',true)`);
  await admin.query(`INSERT INTO ${ns}.contracts VALUES
   (101,'active','active',true),(202,'active','active',true)`);
  await admin.query(`INSERT INTO ${ns}.evidence VALUES(1,101),(2,202)`);
  await admin.query(`GRANT USAGE ON SCHEMA ${ns} TO ${reader}`);
  await admin.query(`GRANT SELECT ON ${ns}.evidence TO ${reader}`);
  await admin.query(`ALTER TABLE ${ns}.evidence ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE ${ns}.evidence FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY alt0810c21_tenant ON ${ns}.evidence TO ${reader}
   USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer
    AND NULLIF(current_setting('app.user_id',true),'')::integer>0)`);
  server.listen(0,'127.0.0.1');await once(server,'listening');serverListening=true;
  const addr=server.address();if(!addr||typeof addr==='string')throw Error('NO_LOOPBACK_PORT');
  const url=`http://127.0.0.1:${addr.port}/observations`;
  const request=async(session:string,tenant:number,custom?:string)=>{
   const response=await fetch(url+'?tenant='+tenant,{headers:{cookie:'vigia_session='+(custom??cookieValue(session))}});
   return {status:response.status,body:await response.json() as {ids?:number[];error?:string}};
  };
  assert.deepEqual(await request('s1',101),{status:200,body:{ids:[1]}});
  assert.deepEqual(await request('s2',202),{status:200,body:{ids:[2]}});
  assert.equal((await request('s1',202)).status,403);
  assert.equal((await request('s2',101)).status,403);
  assert.equal((await request('s1',101,'s1.'+'0'.repeat(64))).status,401);
  assert.equal((await request('s3',101)).status,401);
  const anonymous=await fetch(url+'?tenant=101');
  assert.equal(anonymous.status,401);
  await admin.query(`UPDATE ${ns}.memberships SET active=false WHERE user_id=1001`);
  assert.equal((await request('s1',101)).status,403);
  await admin.query(`UPDATE ${ns}.memberships SET active=true WHERE user_id=1001`);
  await admin.query(`UPDATE ${ns}.contracts SET entitlement_enabled=false WHERE tenant_id=101`);
  assert.equal((await request('s1',101)).status,403);
  await admin.query(`UPDATE ${ns}.contracts SET entitlement_enabled=true WHERE tenant_id=101`);
  await admin.query(`UPDATE ${ns}.sessions SET verified_version=5 WHERE id='s1'`);
  assert.equal((await request('s1',101)).status,401);
  assert.deepEqual(await request('s2',202),{status:200,body:{ids:[2]}});
  console.log('ALT0810C21: loopback HTTP signed cookie, transactional DB session, tenant, membership, entitlement and RLS revocations checked; operations NO-GO');
 }finally{
  if(serverListening)await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  if(created){
   await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${reader}`).catch(()=>{});
  }
  await admin.end();
 }
});
