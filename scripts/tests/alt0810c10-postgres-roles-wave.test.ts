/**
 * ALT-08.10C.10 — PG16 ephemeral, pre-existing catalog + versioned
 * proposed ACL/RLS wave. BEGIN/COMMIT then distinct compensating COMMIT.
 * NO application database, no Neon, no migrate.ts, no production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {snapshotDisposableCatalog} from '../../lib/db/disposable-catalog-snapshot';
import {ALT0810C10_WAVE1,ALT0810C10_UP_SQL,ALT0810C10_DOWN_SQL,
 assertAlt0810c10DisposableEnv} from '../../lib/db/alt0810c10-roles-wave';

assertAlt0810c10DisposableEnv(process.env);
type Result={rows:Record<string,unknown>[];rowCount:number|null};
type Client={connect():Promise<void>;query(s:string,p?:unknown[]):Promise<Result>;end():Promise<void>};
const {Client:PgClient}=createRequire(import.meta.url)('pg') as
 {Client:new(options:Record<string,unknown>)=>Client};
const db=new PgClient({host:'127.0.0.1',port:5432,user:'vigia_ci',
 password:'isolated_ci_only',database:'vigia_alt081_ci'});
const ns=ALT0810C10_WAVE1.schema;
const table=`${ns}.evidence`;
const [migrator,a,b,reader]=ALT0810C10_WAVE1.roles;

async function asRole<T>(role:string,work:()=>Promise<T>):Promise<T>{
 await db.query(`SET ROLE ${role}`);
 try{return await work()}finally{await db.query('RESET ROLE')}
}
test('ALT-08.10C.10: committed versioned ACL/RLS is least-privilege and reversible',async()=>{
 assert.equal(ALT0810C10_WAVE1.operationalMigrationAuthorized,false);
 assert.equal(ALT0810C10_WAVE1.status,'candidate-only-disposable-ci');
 await db.connect();
 let initialized=false,tx=false;
 try{
  const existing=await db.query('SELECT to_regnamespace($1) AS ns',[ns]);
  assert.equal(existing.rows[0]?.ns,null,'preexisting namespace collision');
  const roles=await db.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[[...ALT0810C10_WAVE1.roles]]);
  assert.equal(roles.rows.length,0,'preexisting role collision');
  initialized=true;
  for(const role of ALT0810C10_WAVE1.roles)
   await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION`);
  await db.query(`CREATE SCHEMA ${ns}`);
  await db.query(`CREATE TABLE ${table} (
    id integer PRIMARY KEY,tenant_id integer NOT NULL,
    label text NOT NULL,private_note text NOT NULL,
    CONSTRAINT alt0810c10_positive CHECK(tenant_id>0))`);
  await db.query(`INSERT INTO ${table} VALUES
    (1,101,'A-original','secret-A'),(2,202,'B-original','secret-B')`);
  const rows=async()=>(await db.query(`SELECT id,tenant_id,label,private_note FROM ${table} ORDER BY id`)).rows;
  const originalRows=await rows();
  const baseline=await snapshotDisposableCatalog(db,ns,[...ALT0810C10_WAVE1.roles]);

  await db.query('BEGIN');tx=true;
  for(const sql of ALT0810C10_UP_SQL)await db.query(sql);
  await db.query('COMMIT');tx=false;
  const afterUp=await snapshotDisposableCatalog(db,ns,[...ALT0810C10_WAVE1.roles]);
  assert.notDeepEqual(afterUp,baseline);
  assert.ok(afterUp.relations.some(v=>v.includes(migrator)));
  assert.ok(afterUp.policies.some(v=>v.includes('alt0810c10_a_select')));
  for(const role of [a,b,reader]){
   const flags=await db.query('SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=$1',[role]);
   assert.equal(flags.rows[0].rolsuper,false);
   assert.equal(flags.rows[0].rolbypassrls,false);
   assert.equal(flags.rows[0].rolcreaterole,false);
  }
  for(const [role,allowed,forbidden] of [[a,1,2],[b,2,1]] as const){
   await asRole(role,async()=>{
    const visible=await db.query(`SELECT id,label FROM ${table} ORDER BY id`);
    assert.deepEqual(visible.rows.map(x=>Number(x.id)),[allowed]);
    assert.equal((await db.query(`UPDATE ${table} SET label='blocked' WHERE id=$1`,[forbidden])).rowCount,0);
    await assert.rejects(db.query(`SELECT private_note FROM ${table}`),/permission denied/);
    await assert.rejects(db.query(`CREATE TABLE ${ns}.unauthorized (id int)`),/permission denied/);
    await assert.rejects(db.query(`INSERT INTO ${table} VALUES(9,101,'injected','secret')`),/permission denied/);
   });
  }
  await asRole(reader,async()=>{
   const visible=await db.query(`SELECT id,label FROM ${table} ORDER BY id`);
   assert.equal(visible.rows.length,2);
   await assert.rejects(db.query(`UPDATE ${table} SET label='hacked' WHERE id=1`),/permission denied/);
   await assert.rejects(db.query(`SELECT private_note FROM ${table}`),/permission denied/);
  });
  // Prove the separate migrator is owner and can perform disposable DDL.
  await asRole(migrator,async()=>{
   await db.query(`ALTER TABLE ${table} ADD COLUMN migration_probe integer`);
   await db.query(`ALTER TABLE ${table} DROP COLUMN migration_probe`);
  });
  assert.deepEqual(await rows(),originalRows,'tenant attack must not modify rows');
  await db.query('BEGIN');tx=true;
  for(const sql of ALT0810C10_DOWN_SQL)await db.query(sql);
  await db.query('COMMIT');tx=false;
  assert.deepEqual(await snapshotDisposableCatalog(db,ns,[...ALT0810C10_WAVE1.roles]),baseline,
   'compensation must exactly restore catalog permissions/policies/ownership');
  assert.deepEqual(await rows(),originalRows);
  console.log('ALT0810C10: disposable PG16 roles A/B, reader and migrator; commit and compensating commit VERIFIED; production NO-GO');
 } finally{
  if(tx)await db.query('ROLLBACK').catch(()=>{});
  if(initialized){
   await db.query(`DROP TABLE IF EXISTS ${table}`).catch(()=>{});
   await db.query(`DROP SCHEMA IF EXISTS ${ns}`).catch(()=>{});
   for(const role of [...ALT0810C10_WAVE1.roles].reverse())
    await db.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await db.end();
 }
});
