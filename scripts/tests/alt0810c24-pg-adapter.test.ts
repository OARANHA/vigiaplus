import test from 'node:test';
import assert from 'node:assert/strict';
import {signSession} from '../../lib/session';
import {ALT0810C24,CI_SCHEMA,CI_READER,
 assertAlt0810c24Env,newDisposableClient,readAuthorizedFixture}
 from '../../lib/db/alt0810c24-disposable-pg-adapter';

assertAlt0810c24Env(process.env);
const admin=newDisposableClient(process.env);
const db=newDisposableClient(process.env);
const ns=CI_SCHEMA,role=CI_READER;
test('ALT-08.10C.24: signed session, membership and entitlements on one PG16 connection',async()=>{
 assert.equal(ALT0810C24.operationalEnabled,false);
 await admin.connect();await db.connect();let created=false;
 try{
  assert.equal((await admin.query('SELECT to_regnamespace($1) AS n',[ns])).rows[0].n,null);
  assert.equal((await admin.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0);
  created=true;
  await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
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
  await admin.query(`CREATE POLICY alt0810c24_read ON ${ns}.evidence TO ${role}
    USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer
     AND NULLIF(current_setting('app.user_id',true),'')::integer>0)`);
  assert.deepEqual(await readAuthorizedFixture(db,signSession(1001,0),101),{status:200,ids:[1]});
  assert.deepEqual(await readAuthorizedFixture(db,signSession(2002,0),202),{status:200,ids:[2]});
  assert.deepEqual(await readAuthorizedFixture(db,signSession(1001,0),202),{status:403,ids:[]});
  assert.deepEqual(await readAuthorizedFixture(db,signSession(9001,0),101),{status:403,ids:[]});
  assert.deepEqual(await readAuthorizedFixture(db,'1001.0.'+'0'.repeat(64),101),{status:401,ids:[]});
  assert.deepEqual(await readAuthorizedFixture(db,undefined,101),{status:401,ids:[]});
  await admin.query(`UPDATE ${ns}.memberships SET active=false WHERE user_id=1001`);
  assert.deepEqual(await readAuthorizedFixture(db,signSession(1001,0),101),{status:403,ids:[]});
  await admin.query(`UPDATE ${ns}.memberships SET active=true WHERE user_id=1001`);
  await admin.query(`UPDATE ${ns}.contracts SET entitlement_enabled=false WHERE tenant_id=101`);
  assert.deepEqual(await readAuthorizedFixture(db,signSession(1001,0),101),{status:403,ids:[]});
  await admin.query(`UPDATE ${ns}.contracts SET entitlement_enabled=true WHERE tenant_id=101`);
  await admin.query(`UPDATE ${ns}.users SET session_version=1 WHERE id=1001`);
  assert.deepEqual(await readAuthorizedFixture(db,signSession(1001,0),101),{status:401,ids:[]});
  assert.deepEqual(await readAuthorizedFixture(db,signSession(2002,0),202),{status:200,ids:[2]});
  assert.equal((await db.query('SELECT current_user AS u')).rows[0].u,'vigia_ci');
  const state=await db.query("SELECT NULLIF(current_setting('app.tenant_id',true),'') AS tenant");
  assert.equal(state.rows[0].tenant,null,'transaction scoped tenant leaked');
  console.log('ALT0810C24 PG16 adapter: session/membership/entitlement, revocation, RLS, rollback verified; Next.js integration remains NO-GO');
 }finally{
  if(created){
   await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await db.end();await admin.end();
 }
});
