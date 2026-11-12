/**
 * ALT-08.9: actual HTTP + signed session cookie + PostgreSQL membership and
 * entitlement checks in ONE dedicated Neon staging database.
 * This is a TEST HTTP harness; NOT the deployed Next.js auth route.
 * All objects live in reserved synthetic schema, migrated and reversed.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {signSession,verifySession,SESSION_COOKIE} from '../../lib/session';
import {withNeonRlsPool} from '../../lib/tenant/neon-rls-adapter';
import {withTenantRlsTransaction,type TenantSqlPool,type TenantSqlClient} from '../../lib/tenant/rls-transaction';

const e=process.env;
const DB='vigia_alt086_staging_20261112';
const SCHEMA='alt089_http_ci';
const READER='vigia_alt087_staging_reader';
const MIGRATOR='vigia_alt083_ci_20261112_owner';
type Q=TenantSqlClient['query'];
function host(raw:string|undefined,role:string):string{
 if(!raw)throw Error('ALT089_MISSING_STAGING_SECRET');
 const u=new URL(raw);
 if(!['postgres:','postgresql:'].includes(u.protocol)||!u.hostname.endsWith('.neon.tech')||
   decodeURIComponent(u.pathname.slice(1))!==DB||
   decodeURIComponent(u.username)!==role)throw Error('ALT089_STAGING_CREDENTIAL_MISMATCH');
 return u.hostname;
}
function guard():void{
 if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.NODE_ENV==='production'||
    e.DATABASE_URL||e.VIGIA_RLS_MODE!=='ci-experimental'||
    e.ALT089_STAGING_CONFIRM!=='SIGNED_HTTP_SYNTHETIC_ONLY'||
    !Number.isSafeInteger(Number(e.GITHUB_RUN_ID)))throw Error('ALT089_STAGING_ONLY');
 assert.equal(host(e.RLS_DATABASE_URL,READER),
              host(e.ALT087_STAGING_MIGRATOR_URL,MIGRATOR));
}
async function counts(q:Q){
 const r=await q(`SELECT
 (SELECT count(*)::int FROM pg_namespace WHERE nspname='${SCHEMA}') AS s,
 (SELECT count(*)::int FROM pg_tables WHERE schemaname='${SCHEMA}') AS t,
 (SELECT count(*)::int FROM pg_policies WHERE schemaname='${SCHEMA}') AS p`);
 return [Number(r.rows[0].s),Number(r.rows[0].t),Number(r.rows[0].p)];
}
async function prepare(pool:TenantSqlPool){
 const c=await pool.connect();
 try{
  assert.deepEqual(await counts(c.query.bind(c)),[0,0,0],'staging namespace occupied');
  const v=await c.query('SELECT current_database() AS db,current_user AS role');
  assert.equal(v.rows[0].db,DB);assert.equal(v.rows[0].role,MIGRATOR);
  await c.query('BEGIN');
  try{
   const statements=[
    `CREATE SCHEMA ${SCHEMA}`,
    `CREATE TABLE ${SCHEMA}.users(
       id integer PRIMARY KEY,global_role text,session_version integer NOT NULL)`,
    `CREATE TABLE ${SCHEMA}.memberships(
       user_id integer NOT NULL,tenant_id integer NOT NULL,role text NOT NULL)`,
    `CREATE TABLE ${SCHEMA}.plans(key text PRIMARY KEY)`,
    `CREATE TABLE ${SCHEMA}.plan_features(plan_key text,feature_key text)`,
    `CREATE TABLE ${SCHEMA}.subscriptions(
       tenant_id integer,plan_key text,status text)`,
    `CREATE TABLE ${SCHEMA}.tenant_features(
       tenant_id integer,feature_key text,enabled integer)`,
    `CREATE TABLE ${SCHEMA}.incidents(
       id integer PRIMARY KEY,tenant_id integer NOT NULL,title text NOT NULL,
       private_payload text NOT NULL)`,
    `INSERT INTO ${SCHEMA}.users VALUES
      (101,NULL,0),(102,NULL,0),(103,NULL,0),(104,'owner',0),(105,'analyst',0)`,
    `INSERT INTO ${SCHEMA}.memberships VALUES
      (101,771,'client_admin'),(102,882,'client_viewer'),
      (103,771,'client_viewer')`,
    `INSERT INTO ${SCHEMA}.plans VALUES ('trial')`,
    `INSERT INTO ${SCHEMA}.plan_features VALUES ('trial','reputation_dual')`,
    `INSERT INTO ${SCHEMA}.subscriptions VALUES
      (771,'trial','active'),(882,'trial','active')`,
    `INSERT INTO ${SCHEMA}.tenant_features VALUES
      (771,'reputation_dual',1),(882,'reputation_dual',1)`,
    `INSERT INTO ${SCHEMA}.incidents VALUES
      (1001,771,'ALT089_A','private-A'),(2002,882,'ALT089_B','private-B')`,
    `GRANT USAGE ON SCHEMA ${SCHEMA} TO ${READER}`,
    `GRANT SELECT (id,title) ON ${SCHEMA}.incidents TO ${READER}`,
    `ALTER TABLE ${SCHEMA}.incidents ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${SCHEMA}.incidents FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY alt089_read ON ${SCHEMA}.incidents
      AS PERMISSIVE FOR SELECT TO ${READER}
      USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer)`,
   ];
   for(const s of statements)await c.query(s);
   await c.query('COMMIT');
  }catch(err){await c.query('ROLLBACK');throw err}
  assert.deepEqual(await counts(c.query.bind(c)),[1,7,1]);
 }finally{c.release()}
}
async function resolveAuthorized(pool:TenantSqlPool,cookie:string|undefined){
 const parsed=verifySession(cookie);
 if(!parsed)return null;
 const c=await pool.connect();
 try{
  const q=await c.query(`SELECT u.session_version,u.global_role,
    m.tenant_id,m.role FROM ${SCHEMA}.users u
    LEFT JOIN ${SCHEMA}.memberships m ON m.user_id=u.id
    WHERE u.id=$1 ORDER BY m.tenant_id LIMIT 2`,[parsed.userId]);
  if(q.rows.length!==1)return null; // Multi-tenant must select explicitly.
  const u=q.rows[0];
  if(Number(u.session_version)!==parsed.version||
     u.global_role!==null||
     !['client_admin','client_viewer'].includes(String(u.role))||
     !Number.isSafeInteger(Number(u.tenant_id)))return null;
  const tenant=Number(u.tenant_id);
  const valid=await c.query(`SELECT 1 FROM ${SCHEMA}.subscriptions s
    JOIN ${SCHEMA}.plans p ON p.key=s.plan_key
    JOIN ${SCHEMA}.plan_features pf ON pf.plan_key=p.key
    JOIN ${SCHEMA}.tenant_features tf ON tf.tenant_id=s.tenant_id
       AND tf.feature_key=pf.feature_key
    WHERE s.tenant_id=$1 AND s.status='active'
      AND pf.feature_key='reputation_dual' AND tf.enabled=1
    LIMIT 1`,[tenant]);
  return valid.rows.length===1?tenant:null;
 }finally{c.release()}
}
async function serve(owner:TenantSqlPool,reader:TenantSqlPool){
 const server=createServer(async(req,res)=>{
  const send=(status:number,value:unknown)=>{
   res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
   res.end(JSON.stringify(value));
  };
  try{
   if(req.method!=='GET'||!req.url?.startsWith('/api/staging/incidents')){
    send(404,{error:'not-found'});return;
   }
   const raw=req.headers.cookie?.split(';').map(x=>x.trim())
    .find(x=>x.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1);
   const tenant=await resolveAuthorized(owner,raw);
   if(tenant===null){send(401,{error:'unauthorized'});return}
   // Never use tenant_id from request URL, headers or body for the RLS scope.
   const items=await withTenantRlsTransaction(reader,tenant,q=>
      q(`SELECT id,title FROM ${SCHEMA}.incidents ORDER BY id`));
   send(200,{tenantId:tenant,items:items.rows});
  }catch{send(500,{error:'internal'})}
 });
 server.listen(0,'127.0.0.1');
 await once(server,'listening');
 const address=server.address();
 assert.ok(address&&typeof address!=='string');
 const origin=`http://127.0.0.1:${address.port}`;
 async function request(user?:number,version=0,query='',raw?:string){
  const cookie=raw??(user?signSession(user,version):undefined);
  const r=await fetch(origin+'/api/staging/incidents'+query,{
   headers:cookie?{cookie:`${SESSION_COOKIE}=${cookie}`}:{},
   signal:AbortSignal.timeout(15000)});
  return {status:r.status,body:await r.json() as {
   tenantId?:number;items?:{id:number;title:string}[];error?:string}};
 }
 try{
  assert.equal((await request()).status,401);
  assert.equal((await request(undefined,0,'','forged')).status,401);
  const a=await request(101,0,'?tenant_id=882');
  assert.equal(a.status,200);
  assert.equal(a.body.tenantId,771);
  assert.deepEqual(a.body.items?.map(x=>x.id),[1001]);
  const b=await request(102,0,'?tenant_id=771');
  assert.equal(b.status,200);
  assert.equal(b.body.tenantId,882);
  assert.deepEqual(b.body.items?.map(x=>x.id),[2002]);
  assert.equal((await request(104)).status,401);
  assert.equal((await request(105)).status,401);
  assert.equal((await request(103)).status,200);
  // Revoking membership invalidates an otherwise valid signed cookie.
  const membershipAdmin=await owner.connect();
  try{
   await membershipAdmin.query(`DELETE FROM ${SCHEMA}.memberships WHERE user_id=103`);
  }finally{membershipAdmin.release()}
  assert.equal((await request(103)).status,401,'removed membership must deny');
  // Revoke a valid signature by incrementing session_version in the same DB.
  const admin=await owner.connect();
  try{
   await admin.query(`UPDATE ${SCHEMA}.users SET session_version=1 WHERE id=101`);
  }finally{admin.release()}
  assert.equal((await request(101,0)).status,401,'revoked cookie must die');
  assert.equal((await request(101,1)).status,200,'current version works');
  const admin2=await owner.connect();
  try{
   await admin2.query(`UPDATE ${SCHEMA}.tenant_features
      SET enabled=0 WHERE tenant_id=771`);
  }finally{admin2.release()}
  assert.equal((await request(101,1)).status,401,'disabled feature must deny');
  assert.equal((await request(102)).status,200,'other tenant still works');
  const admin3=await owner.connect();
  try{
   await admin3.query(`UPDATE ${SCHEMA}.subscriptions
      SET status='canceled' WHERE tenant_id=882`);
  }finally{admin3.release()}
  assert.equal((await request(102)).status,401,'canceled subscription must deny');
  console.log('ALT089 STAGING HTTP: signed cookie, DB session revocation, membership, role and entitlement checks, A/B RLS VERIFIED');
 }finally{
  server.close();
  await once(server,'close');
 }
}
async function cleanup(pool:TenantSqlPool){
 const c=await pool.connect();
 try{
  assert.deepEqual(await counts(c.query.bind(c)),[1,7,1]);
  await c.query('BEGIN');
  try{
   await c.query(`DROP POLICY alt089_read ON ${SCHEMA}.incidents`);
   await c.query(`ALTER TABLE ${SCHEMA}.incidents NO FORCE ROW LEVEL SECURITY`);
   await c.query(`ALTER TABLE ${SCHEMA}.incidents DISABLE ROW LEVEL SECURITY`);
   await c.query(`REVOKE SELECT (id,title) ON ${SCHEMA}.incidents FROM ${READER}`);
   await c.query(`REVOKE USAGE ON SCHEMA ${SCHEMA} FROM ${READER}`);
   for(const t of ['incidents','tenant_features','subscriptions','plan_features',
       'plans','memberships','users'])await c.query(`DROP TABLE ${SCHEMA}.${t}`);
   await c.query(`DROP SCHEMA ${SCHEMA}`);
   await c.query('COMMIT');
  }catch(err){await c.query('ROLLBACK');throw err}
  assert.deepEqual(await counts(c.query.bind(c)),[0,0,0]);
  console.log('ALT089 STAGING: explicit reverse migration and catalog 0/0/0 VERIFIED');
 }finally{c.release()}
}
async function main(){
 guard();
 const migratorEnv={...e,RLS_DATABASE_URL:e.ALT087_STAGING_MIGRATOR_URL};
 await withNeonRlsPool(migratorEnv,async owner=>{
  let initialized=false;
  try{
   await prepare(owner);
   initialized=true;
   await withNeonRlsPool(e,readPool=>serve(owner,readPool));
  }finally{if(initialized)await cleanup(owner)}
 });
}
main().catch(err=>{
 console.error('ALT089 STAGING NO-GO:',err instanceof Error?err.message:'unknown');
 process.exitCode=1;
});
