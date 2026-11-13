/**
 * ALT-08.10C.18 — proof in disposable PG16 that legacy optional tenant
 * context permits cross-tenant visibility and a strict policy fails closed.
 * This is an adversarial demonstration, NOT an application RLS migration.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.ALT0810C18_EPHEMERAL!=='1'||
 e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||
 e.PGDATABASE!=='vigia_alt081_ci'||e.PGUSER!=='vigia_ci'||
 e.PGPASSWORD!=='isolated_ci_only'||e.DATABASE_URL||e.RLS_DATABASE_URL||
 e.NODE_ENV==='production')throw Error('ALT0810C18_DISPOSABLE_ONLY');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const legacy=readFileSync(resolve(root,'migrations/00002_rls.sql'),'utf8');
assert.match(legacy,/current_setting\s*\(\s*'app\.tenant_id'\s*,\s*true\s*\)\s+IS\s+NULL/i,
 'Legacy policy no longer explicitly accepts missing tenant context: review test');
type Client={connect():Promise<void>;query(sql:string,args?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount:number|null}>;end():Promise<void>};
const {Client:PG}=createRequire(import.meta.url)('pg') as {Client:new(opts:Record<string,unknown>)=>Client};
const db=new PG({host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
 user:'vigia_ci',password:'isolated_ci_only'});
const schema='alt0810c6_rls_probe18',role='alt0810c6_rls_reader18';
test('ALT-08.10C.18: missing tenant context leaks in legacy semantics, strict RLS denies',async()=>{
 await db.connect();let created=false;let tx=false;
 try{
  const preflight=await db.query('SELECT to_regnamespace($1) AS ns',[schema]);
  assert.equal(preflight.rows[0].ns,null);
  assert.equal((await db.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[role])).rows.length,0);
  created=true;
  await db.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE`);
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`CREATE TABLE ${schema}.evidence(id integer PRIMARY KEY,tenant_id integer NOT NULL)`);
  await db.query(`INSERT INTO ${schema}.evidence VALUES (1,101),(2,202)`);
  await db.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
  await db.query(`GRANT SELECT ON ${schema}.evidence TO ${role}`);
  await db.query(`ALTER TABLE ${schema}.evidence ENABLE ROW LEVEL SECURITY`);
  await db.query(`ALTER TABLE ${schema}.evidence FORCE ROW LEVEL SECURITY`);
  await db.query(`CREATE POLICY optional_tenant_context ON ${schema}.evidence TO ${role}
   USING (current_setting('app.tenant_id',true) IS NULL
          OR current_setting('app.tenant_id',true)=''
          OR tenant_id=current_setting('app.tenant_id',true)::integer)`);
  await db.query('BEGIN');tx=true;
  await db.query(`SET LOCAL ROLE ${role}`);
  const visible=(await db.query(`SELECT id FROM ${schema}.evidence ORDER BY id`)).rows.map(x=>Number(x.id));
  assert.deepEqual(visible,[1,2],'legacy optional context must be shown unsafe, not normalized');
  await db.query('ROLLBACK');tx=false;
  await db.query(`DROP POLICY optional_tenant_context ON ${schema}.evidence`);
  await db.query(`CREATE POLICY required_tenant_context ON ${schema}.evidence TO ${role}
   USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer)`);
  await db.query('BEGIN');tx=true;
  await db.query(`SET LOCAL ROLE ${role}`);
  const missing=(await db.query(`SELECT id FROM ${schema}.evidence ORDER BY id`)).rows;
  assert.deepEqual(missing,[],'missing tenant context MUST DENY');
  await db.query(`SELECT set_config('app.tenant_id','101',true)`);
  const own=(await db.query(`SELECT id FROM ${schema}.evidence ORDER BY id`)).rows.map(x=>Number(x.id));
  assert.deepEqual(own,[1]);
  await db.query('ROLLBACK');tx=false;
  console.log('ALT0810C18: legacy NULL-context cross-tenant visibility reproduced; strict policy blocks it; production NO-GO');
 }finally{
  if(tx)await db.query('ROLLBACK').catch(()=>{});
  if(created){
   await db.query(`DROP TABLE IF EXISTS ${schema}.evidence`).catch(()=>{});
   await db.query(`DROP SCHEMA IF EXISTS ${schema}`).catch(()=>{});
   await db.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await db.end();
 }
});
