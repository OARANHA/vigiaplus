import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {signSession} from '../../lib/session';
import {ALT0810C30,authorizedTenantRead,type TxQuery}
 from '../../lib/tenant/alt0810c30-transactional-read';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
 e.ALT0810C30_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
 e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
 e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
 e.DATABASE_URL||e.RLS_DATABASE_URL||e.NODE_ENV==='production')
 throw Error('ALT0810C30_DISPOSABLE_ONLY');

type Port=TxQuery&{connect():Promise<void>;end():Promise<void>};
const {Client}=createRequire(import.meta.url)('pg') as
 {Client:new(options:Record<string,unknown>)=>Port};
const cfg={host:'127.0.0.1',port:5432,user:'vigia_ci',
 password:'isolated_ci_only',database:'vigia_alt081_ci'};
const admin=new Client(cfg),reader=new Client(cfg);
const ns='alt0810c30_scope',role='alt0810c30_reader';
const secret='ALT0810C30_Only_Disposable_Session_2026_Strong_Key';

test('ALT-08.10C.30 PG16 same-connection signed session, membership, entitlements, FORCE RLS',async()=>{
 assert.equal(ALT0810C30.operationalEnabled,false);
 process.env.SESSION_SECRET=secret;
 await admin.connect();await reader.connect();
 let created=false;
 try{
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS n',[ns])).rows[0].n,null);
  assert.equal((await admin.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[role])).rows.length,0);
  created=true;
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE`);
  await admin.query(`CREATE SCHEMA ${ns}`);
  await admin.query(`SET search_path TO ${ns}`);
  await reader.query(`SET search_path TO ${ns}`);
  await admin.query(`CREATE TABLE users(id int primary key,session_version int NOT NULL,global_role text)`);
  await admin.query(`CREATE TABLE tenants(id int primary key,status text NOT NULL)`);
  await admin.query(`CREATE TABLE memberships(user_id int,tenant_id int,role text)`);
  await admin.query(`CREATE TABLE subscriptions(id serial primary key,tenant_id int,plan_key text,status text,
    vigencia_ate timestamptz,grace_until timestamptz)`);
  await admin.query(`CREATE TABLE tenant_features(tenant_id int,feature_key text,enabled int,expires_at timestamptz)`);
  await admin.query(`CREATE TABLE plan_features(plan_key text,feature_key text)`);
  await admin.query(`CREATE TABLE evidence(id int primary key,tenant_id int NOT NULL)`);
  await admin.query(`INSERT INTO users VALUES(1001,0,NULL),(2002,0,NULL),(9001,0,'owner')`);
  await admin.query(`INSERT INTO tenants VALUES(101,'active'),(202,'active')`);
  await admin.query(`INSERT INTO memberships VALUES(1001,101,'client_viewer'),(2002,202,'client_admin')`);
  await admin.query(`INSERT INTO subscriptions(tenant_id,plan_key,status)
    VALUES(101,'ci30','active'),(202,'ci30','active')`);
  await admin.query(`INSERT INTO plan_features VALUES('ci30','reports')`);
  await admin.query(`INSERT INTO evidence VALUES(1,101),(2,202)`);
  await admin.query(`GRANT ${role} TO vigia_ci`);
  await admin.query(`GRANT USAGE ON SCHEMA ${ns} TO ${role}`);
  await admin.query(`GRANT SELECT ON ${ns}.evidence TO ${role}`);
  await admin.query(`ALTER TABLE evidence ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE evidence FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY ci30_evidence ON evidence FOR SELECT TO ${role}
    USING(tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::int
      AND NULLIF(current_setting('app.user_id',true),'')::int>0)`);
  const read=async(cookie:string|undefined,tenantId:number)=>{
   const out=await authorizedTenantRead({db:reader,cookie,tenantId,
    featureKey:'reports',readerRole:role,
    read:async db=>{const r=await db.query(`SELECT id FROM ${ns}.evidence ORDER BY id`);
     return r.rows.map(x=>Number(x.id));}});
   return out;
  };
  assert.deepEqual(await read(signSession(1001,0),101),{status:200,data:[1]});
  assert.deepEqual(await read(signSession(2002,0),202),{status:200,data:[2]});
  assert.deepEqual(await read(signSession(1001,0),202),{status:403,data:null});
  assert.deepEqual(await read(signSession(9001,0),101),{status:403,data:null});
  assert.deepEqual(await read(undefined,101),{status:401,data:null});
  assert.deepEqual(await read('invalid',101),{status:401,data:null});
  await admin.query(`INSERT INTO tenant_features VALUES(101,'reports',0,NULL)`);
  assert.deepEqual(await read(signSession(1001,0),101),{status:403,data:null});
  assert.deepEqual(await read(signSession(2002,0),202),{status:200,data:[2]});
  await admin.query(`DELETE FROM tenant_features WHERE tenant_id=101`);
  await admin.query(`UPDATE subscriptions SET status='suspended' WHERE tenant_id=101`);
  assert.deepEqual(await read(signSession(1001,0),101),{status:403,data:null});
  await admin.query(`UPDATE subscriptions SET status='active' WHERE tenant_id=101`);
  await admin.query(`DELETE FROM memberships WHERE user_id=1001`);
  assert.deepEqual(await read(signSession(1001,0),101),{status:403,data:null});
  await admin.query(`INSERT INTO memberships VALUES(1001,101,'client_viewer')`);
  await admin.query(`UPDATE users SET session_version=1 WHERE id=1001`);
  assert.deepEqual(await read(signSession(1001,0),101),{status:401,data:null});
  assert.deepEqual(await read(signSession(1001,1),101),{status:200,data:[1]});
  const noLeak=await reader.query(`SELECT current_user AS who,
    NULLIF(current_setting('app.tenant_id',true),'') AS tid,
    NULLIF(current_setting('app.user_id',true),'') AS uid`);
  assert.equal(noLeak.rows[0].who,'vigia_ci');
  assert.equal(noLeak.rows[0].tid,null);
  assert.equal(noLeak.rows[0].uid,null);
  const rl=await reader.query(`SELECT rolbypassrls FROM pg_roles WHERE rolname=$1`,[role]);
  assert.equal(rl.rows[0].rolbypassrls,false);
  console.log('ALT0810C30 PG16: one connection + transaction, positive FORCE RLS tenant A/B, session/contract/membership revocation and GUC rollback; operational activation remains NO-GO');
 }finally{
  if(created){
   await admin.query('SET search_path TO public').catch(()=>{});
   await reader.query('SET search_path TO public').catch(()=>{});
   await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await reader.end();await admin.end();
 }
});
