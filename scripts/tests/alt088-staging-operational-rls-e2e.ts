/**
 * ALT-08.8: staging isolated synthetic operational contract.
 * It is deliberately NOT a deployment of the app schema or HTTP auth.
 */
import assert from 'node:assert/strict';
import {withNeonRlsPool} from '../../lib/tenant/neon-rls-adapter';
import {withTenantRlsTransaction,type TenantSqlPool,type TenantSqlClient} from '../../lib/tenant/rls-transaction';
import {ALT085_WAVE1_TABLES,ALT085_WAVE1_READ_COLUMNS} from '../../lib/tenant/rls-operational-wave1';
import {ALT086_ROLE_MATRIX} from '../../lib/tenant/rls-preproduction-gate';

const env=process.env;
const ns='alt088_operational_ci';
const database='vigia_alt086_staging_20261112';
const reader='vigia_alt087_staging_reader';
const ownerRole='vigia_alt083_ci_20261112_owner';
type Query=TenantSqlClient['query'];

function validatedHost(value:string|undefined,role:string){
 if(!value)throw Error('ALT088_MISSING_STAGING_SECRET');
 const u=new URL(value);
 if(!['postgres:','postgresql:'].includes(u.protocol)||
  !u.hostname.endsWith('.neon.tech')||
  decodeURIComponent(u.pathname.slice(1))!==database||
  decodeURIComponent(u.username)!==role)throw Error('ALT088_WRONG_STAGING_CREDENTIAL');
 return u.hostname;
}
function guard(){
 if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.NODE_ENV==='production'||
  env.DATABASE_URL||env.VIGIA_RLS_MODE!=='ci-experimental'||
  env.ALT088_STAGING_CONFIRM!=='SYNTHETIC_CONTRACT_ONLY'||
  !/^\d+$/.test(env.GITHUB_RUN_ID??''))throw Error('ALT088_STAGING_ONLY');
 assert.equal(validatedHost(env.RLS_DATABASE_URL,reader),
  validatedHost(env.ALT087_STAGING_MIGRATOR_URL,ownerRole));
}
async function catalog(q:Query):Promise<number[]>{
 const r=await q(`SELECT
  (SELECT count(*)::int FROM pg_namespace WHERE nspname='${ns}') AS s,
  (SELECT count(*)::int FROM pg_tables WHERE schemaname='${ns}') AS t,
  (SELECT count(*)::int FROM pg_policies WHERE schemaname='${ns}') AS p`);
 return [Number(r.rows[0].s),Number(r.rows[0].t),Number(r.rows[0].p)];
}
const create=[
 'CREATE TABLE tenants(id integer PRIMARY KEY,name text NOT NULL)',
 'CREATE TABLE users(id integer PRIMARY KEY,global_role text)',
 'CREATE TABLE memberships(user_id integer NOT NULL,tenant_id integer NOT NULL,role text NOT NULL)',
 'CREATE TABLE plans(key text PRIMARY KEY)',
 'CREATE TABLE plan_features(plan_key text NOT NULL,feature_key text NOT NULL)',
 'CREATE TABLE subscriptions(tenant_id integer NOT NULL,plan_key text NOT NULL,status text NOT NULL)',
 'CREATE TABLE tenant_features(tenant_id integer NOT NULL,feature_key text NOT NULL,enabled integer NOT NULL)',
 'CREATE TABLE reputation_targets(id integer PRIMARY KEY,tenant_id integer NOT NULL,name text,kind text,score real,keywords text)',
 'CREATE TABLE incidents(id integer PRIMARY KEY,tenant_id integer NOT NULL,title text,status text,severity text,owner text)',
 'CREATE TABLE notification_channels(id integer PRIMARY KEY,tenant_id integer NOT NULL,channel text,active integer,verified integer,destination text)',
 'CREATE TABLE invoices(id integer PRIMARY KEY,tenant_id integer NOT NULL,amount_brl real,status text,due_at date,pix_copia_cola text)'
] as const;
const seed=[
 "INSERT INTO tenants VALUES(771,'A'),(882,'B')",
 "INSERT INTO users VALUES(101,NULL),(102,NULL),(103,NULL),(104,'owner'),(105,'analyst')",
 "INSERT INTO memberships VALUES(101,771,'client_admin'),(102,882,'client_viewer'),(103,771,'client_viewer')",
 "INSERT INTO plans VALUES('trial'),('standard')",
 "INSERT INTO plan_features VALUES('trial','reputation_dual'),('standard','reputation_dual')",
 "INSERT INTO subscriptions VALUES(771,'trial','active'),(882,'standard','active')",
 "INSERT INTO tenant_features VALUES(771,'reputation_dual',1),(882,'reputation_dual',1)",
 "INSERT INTO reputation_targets VALUES(1001,771,'A','brand',0.8,'sensitiveA'),(2002,882,'B','brand',0.5,'sensitiveB')",
 "INSERT INTO incidents VALUES(1001,771,'A','open','low','privateA'),(2002,882,'B','open','low','privateB')",
 "INSERT INTO notification_channels VALUES(1001,771,'email',1,1,'privateA'),(2002,882,'email',1,1,'privateB')",
 "INSERT INTO invoices VALUES(1001,771,10,'open',NULL,'privateA'),(2002,882,20,'open',NULL,'privateB')"
] as const;

async function setup(pool:TenantSqlPool){
 const c=await pool.connect();
 try{
  const role=await c.query('SELECT current_database() AS db,current_user AS role');
  assert.equal(role.rows[0].db,database);
  assert.equal(role.rows[0].role,ownerRole);
  assert.deepEqual(await catalog(c.query.bind(c)),[0,0,0]);
  await c.query('BEGIN');
  try{
   await c.query(`CREATE SCHEMA ${ns}`);
   for(const ddl of create)await c.query(ddl.replace('CREATE TABLE ',`CREATE TABLE ${ns}.`));
   for(const sql of seed)await c.query(sql.replace('INSERT INTO ',`INSERT INTO ${ns}.`));
   await c.query(`GRANT USAGE ON SCHEMA ${ns} TO ${reader}`);
   for(const t of ALT085_WAVE1_TABLES){
    const cols=ALT085_WAVE1_READ_COLUMNS[t].join(',');
    await c.query(`GRANT SELECT (${cols}) ON ${ns}.${t} TO ${reader}`);
    await c.query(`ALTER TABLE ${ns}.${t} ENABLE ROW LEVEL SECURITY`);
    await c.query(`ALTER TABLE ${ns}.${t} FORCE ROW LEVEL SECURITY`);
    await c.query(`CREATE POLICY alt088_read ON ${ns}.${t} AS PERMISSIVE
       FOR SELECT TO ${reader}
       USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer)`);
   }
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}
  assert.deepEqual(await catalog(c.query.bind(c)),[1,11,4]);
 }finally{c.release()}
}
async function membership(pool:TenantSqlPool,user:number,tenant:number):Promise<boolean>{
 const c=await pool.connect();
 try{
  const r=await c.query(`SELECT m.role FROM ${ns}.memberships m
   JOIN ${ns}.users u ON u.id=m.user_id
   JOIN ${ns}.subscriptions s ON s.tenant_id=m.tenant_id
   JOIN ${ns}.plan_features f ON f.plan_key=s.plan_key
   JOIN ${ns}.tenant_features tf ON tf.tenant_id=m.tenant_id
    AND tf.feature_key=f.feature_key
   WHERE m.user_id=$1 AND m.tenant_id=$2
    AND u.global_role IS NULL AND m.role IN ('client_admin','client_viewer')
    AND s.status='active' AND f.feature_key='reputation_dual' AND tf.enabled=1`,[user,tenant]);
  return r.rows.length===1;
 }finally{c.release()}
}
async function verify(owner:TenantSqlPool,readPool:TenantSqlPool){
 const c=await readPool.connect();
 try{
  const r=await c.query(`SELECT current_user AS role,
    (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass`);
  assert.equal(r.rows[0].role,reader);
  assert.equal(r.rows[0].bypass,false);
  assert.equal((await c.query(`SELECT id FROM ${ns}.incidents`)).rows.length,0);
  await assert.rejects(c.query(`SELECT * FROM ${ns}.users`),/permission denied|42501/i);
  await assert.rejects(c.query(`SELECT destination FROM ${ns}.notification_channels`),
    /permission denied|42501/i);
 }finally{c.release()}
 for(const role of ['owner','analyst','worker','webhook'] as const)
  assert.equal(ALT086_ROLE_MATRIX[role].read,false);
 for(const [user,tenant,allowed] of [
  [101,771,true],[102,882,true],[101,882,false],
  [102,771,false],[104,771,false],[105,882,false]
 ] as const)assert.equal(await membership(owner,user,tenant),allowed);
 for(const [user,tenant,id] of [[101,771,1001],[102,882,2002]] as const){
  assert.equal(await membership(owner,user,tenant),true);
  for(const table of ALT085_WAVE1_TABLES){
   const r=await withTenantRlsTransaction(readPool,tenant,q=>q(
     `SELECT id FROM ${ns}.${table} ORDER BY id`));
   assert.deepEqual(r.rows.map(x=>Number(x.id)),[id]);
  }
 }
 await assert.rejects(withTenantRlsTransaction(readPool,771,q=>q(
   `UPDATE ${ns}.incidents SET status='closed' WHERE id=1001`)),
   /permission denied|42501/i);
 const after=await readPool.connect();
 try{assert.equal((await after.query(`SELECT id FROM ${ns}.invoices`)).rows.length,0)}
 finally{after.release()}
 console.log('ALT088 STAGING: memberships, plans, entitlements, RLS A/B, denied sensitive/write VERIFIED');
}
async function cleanup(pool:TenantSqlPool){
 const c=await pool.connect();
 try{
  assert.deepEqual(await catalog(c.query.bind(c)),[1,11,4]);
  await c.query('BEGIN');
  try{
   for(const table of [...ALT085_WAVE1_TABLES].reverse()){
    await c.query(`DROP POLICY alt088_read ON ${ns}.${table}`);
    await c.query(`ALTER TABLE ${ns}.${table} NO FORCE ROW LEVEL SECURITY`);
    await c.query(`ALTER TABLE ${ns}.${table} DISABLE ROW LEVEL SECURITY`);
    await c.query(`REVOKE SELECT (${ALT085_WAVE1_READ_COLUMNS[table].join(',')})
      ON ${ns}.${table} FROM ${reader}`);
   }
   await c.query(`REVOKE USAGE ON SCHEMA ${ns} FROM ${reader}`);
   for(const table of [
    ...ALT085_WAVE1_TABLES,'tenant_features','subscriptions','plan_features',
    'memberships','plans','users','tenants'
   ])await c.query(`DROP TABLE ${ns}.${table}`);
   await c.query(`DROP SCHEMA ${ns}`);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e}
  assert.deepEqual(await catalog(c.query.bind(c)),[0,0,0]);
  console.log('ALT088 STAGING: per-table rollback; catalog 0/0/0 VERIFIED');
 }finally{c.release()}
}
async function main(){
 guard();
 const ownerEnv={...env,RLS_DATABASE_URL:env.ALT087_STAGING_MIGRATOR_URL};
 await withNeonRlsPool(ownerEnv,async owner=>{
  let done=false;
  try{
   await setup(owner);
   done=true;
   await withNeonRlsPool(env,pool=>verify(owner,pool));
  }finally{
   if(done)await cleanup(owner);
  }
 });
}
main().catch(e=>{
 console.error('ALT088 STAGING NO-GO:',e instanceof Error?e.message:'unknown');
 process.exitCode=1;
});
