/** ALT-08.10C.19: membership-bound, fail-closed RLS exercise.
 * Tests ONLY the PostgreSQL16 GitHub runner service.
 * GUCs are spoofable by a DB client: this is a policy candidate, not identity
 * verification. Never connect it to operational Neon auth.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ALT0810C19,ALT0810C19_POLICY_SQL,
 assertAlt0810c19DisposableEnv} from '../../lib/db/alt0810c19-membership-rls';
assertAlt0810c19DisposableEnv(process.env);
type Result={rows:Record<string,unknown>[];rowCount:number|null};
type Db={connect():Promise<void>;query(s:string,p?:unknown[]):Promise<Result>;end():Promise<void>};
const {Client}=createRequire(import.meta.url)('pg') as
 {Client:new(opts:Record<string,unknown>)=>Db};
const db=new Client({host:'127.0.0.1',port:5432,user:'vigia_ci',
 password:'isolated_ci_only',database:'vigia_alt081_ci'});
const ns=ALT0810C19.schema, [reader,owner]=ALT0810C19.roles;
const evidence=`${ns}.evidence`;
const select=async()=> (await db.query(`SELECT id FROM ${evidence} ORDER BY id`)).rows.map(r=>Number(r.id));
async function scoped(role:string,userId:string,tenantId:string,check:()=>Promise<void>){
 await db.query('BEGIN');
 try{
  await db.query(`SET LOCAL ROLE ${role}`);
  if(userId)await db.query('SELECT set_config($1,$2,true)',['app.user_id',userId]);
  if(tenantId)await db.query('SELECT set_config($1,$2,true)',['app.tenant_id',tenantId]);
  await check();
 }finally{await db.query('ROLLBACK')}
}
test('ALT-08.10C.19: membership, revocation and isolated owner read fail closed',async()=>{
 assert.equal(ALT0810C19.operationalMigrationAuthorized,false);
 await db.connect();let created=false;
 try{
  assert.equal((await db.query('SELECT to_regnamespace($1) AS n',[ns])).rows[0].n,null);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1::text[])',[[...ALT0810C19.roles]])).rows[0].n,0);
  created=true;
  for(const role of ALT0810C19.roles)
   await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
  await db.query(`CREATE SCHEMA ${ns}`);
  await db.query(`CREATE TABLE ${ns}.memberships(
   tenant_id int NOT NULL,user_id int NOT NULL,role text NOT NULL,active boolean NOT NULL,
   PRIMARY KEY(tenant_id,user_id))`);
  await db.query(`CREATE TABLE ${ns}.internal_roles(
   user_id int PRIMARY KEY,role text NOT NULL,active boolean NOT NULL)`);
  await db.query(`CREATE TABLE ${evidence}(
   id int PRIMARY KEY,tenant_id int NOT NULL,secret text NOT NULL)`);
  await db.query(`INSERT INTO ${evidence} VALUES (1,101,'A'),(2,202,'B')`);
  await db.query(`INSERT INTO ${ns}.memberships VALUES
   (101,1001,'client_viewer',true),(202,2002,'client_admin',true),
   (101,1003,'client_viewer',false)`);
  await db.query(`INSERT INTO ${ns}.internal_roles VALUES (9001,'owner',true),(9002,'owner',false)`);
  await db.query(`GRANT USAGE ON SCHEMA ${ns} TO ${reader},${owner}`);
  await db.query(`GRANT SELECT ON ${evidence} TO ${reader},${owner}`);
  await db.query(`GRANT SELECT ON ${ns}.memberships TO ${reader}`);
  await db.query(`GRANT SELECT ON ${ns}.internal_roles TO ${owner}`);
  for(const statement of ALT0810C19_POLICY_SQL)await db.query(statement);

  await scoped(reader,'','',async()=>assert.deepEqual(await select(),[]));
  await scoped(reader,'1001','',async()=>assert.deepEqual(await select(),[]));
  await scoped(reader,'','101',async()=>assert.deepEqual(await select(),[]));
  await scoped(reader,'1001','101',async()=>assert.deepEqual(await select(),[1]));
  await scoped(reader,'1001','202',async()=>assert.deepEqual(await select(),[]));
  await scoped(reader,'2002','202',async()=>assert.deepEqual(await select(),[2]));
  await scoped(reader,'1003','101',async()=>assert.deepEqual(await select(),[]));

  await scoped(owner,'9001','101',async()=>assert.deepEqual(await select(),[1]));
  await scoped(owner,'9001','202',async()=>assert.deepEqual(await select(),[2]));
  await scoped(owner,'9001','',async()=>assert.deepEqual(await select(),[]));
  await scoped(owner,'9002','101',async()=>assert.deepEqual(await select(),[]));
  await scoped(owner,'1001','101',async()=>assert.deepEqual(await select(),[]));

  await db.query(`UPDATE ${ns}.memberships SET active=false WHERE user_id=1001`);
  await scoped(reader,'1001','101',async()=>assert.deepEqual(await select(),[]));
  await db.query(`DELETE FROM ${ns}.memberships WHERE user_id=2002`);
  await scoped(reader,'2002','202',async()=>assert.deepEqual(await select(),[]));
  await db.query(`UPDATE ${ns}.internal_roles SET active=false WHERE user_id=9001`);
  await scoped(owner,'9001','101',async()=>assert.deepEqual(await select(),[]));
  for(const role of ALT0810C19.roles){
   const flags=await db.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=$1',[role]);
   assert.deepEqual(flags.rows,[{rolsuper:false,rolbypassrls:false,rolcreaterole:false}]);
  }
  console.log('ALT0810C19 PG16: missing context DENY, tenants A/B, membership/internal-role revocation DENY; candidate NO-GO');
 }finally{
  if(created){
   await db.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`).catch(()=>{});
   for(const role of [...ALT0810C19.roles].reverse())
    await db.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await db.end();
 }
});
