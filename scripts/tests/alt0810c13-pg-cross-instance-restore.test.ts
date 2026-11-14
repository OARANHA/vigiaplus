/**
 * ALT-08.10C.13 — cross-instance restore + drift detection on TWO disposable
 * PostgreSQL 16 GitHub Actions services. Never accesses Neon/staging/production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshotDisposableCatalog} from '../../lib/db/disposable-catalog-snapshot';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||
 e.ALT0810C13_EPHEMERAL!=='1'||e.RUNNER_OS!=='Linux'||
 e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||
 e.PGDATABASE!=='vigia_alt081_ci'||e.PGUSER!=='vigia_ci'||
 e.PGPASSWORD!=='isolated_ci_only'||
 e.ALT0810C13_DEST_HOST!=='127.0.0.1'||
 e.ALT0810C13_DEST_PORT!=='5433'||
 e.ALT0810C13_DEST_DATABASE!=='vigia_alt0810c13_restore_ci'||
 e.DATABASE_URL||e.RLS_DATABASE_URL||e.NODE_ENV==='production')
 throw Error('ALT0810C13_TWO_DISPOSABLE_POSTGRES_ONLY');
type Result={rows:Record<string,unknown>[];rowCount:number|null};
type Db={connect():Promise<void>;query(s:string,p?:unknown[]):Promise<Result>;end():Promise<void>};
const {Client}=createRequire(import.meta.url)('pg') as {Client:new(args:Record<string,unknown>)=>Db};
const connection={host:'127.0.0.1',user:'vigia_ci',password:'isolated_ci_only'};
const src=new Client({...connection,port:5432,database:'vigia_alt081_ci'});
const dst=new Client({...connection,port:5433,database:'vigia_alt0810c13_restore_ci'});
const ns='alt0810c6_cross_instance';
const owner='alt0810c6_cross_owner',reader='alt0810c6_cross_reader';
const roles=[owner,reader];
const table=`${ns}.observations`;
const records=`SELECT id,tenant_id,label,secret FROM ${table} ORDER BY id`;
const execPg=(args:string[],dir:string)=>{
 execFileSync('docker',[
  'run','--rm','--network','host','--volume',`${dir}:/backup`,
  '--env','PGPASSWORD=isolated_ci_only','postgres:16',...args,
 ],{timeout:120000,maxBuffer:4*1024*1024});
};
async function preflight(db:Db,label:string){
 const existing=await db.query('SELECT to_regnamespace($1) AS schema',[ns]);
 assert.equal(existing.rows[0]?.schema,null,`${label} existing schema`);
 const rs=await db.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[roles]);
 assert.equal(rs.rows.length,0,`${label} existing roles`);
}
async function rolesCreate(db:Db){
 for(const r of roles)
  await db.query(`CREATE ROLE ${r} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`);
}
async function cleanup(db:Db,created:boolean){
 if(!created)return;
 await db.query(`DROP TABLE IF EXISTS ${table}`).catch(()=>{});
 await db.query(`DROP SCHEMA IF EXISTS ${ns}`).catch(()=>{});
 for(const role of [...roles].reverse())await db.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
}
test('ALT-08.10C.13: cross-instance pg_dump/restore, verified drift and no privilege escalation',async()=>{
 await src.connect();
 let dstConnected=false,sourceCreated=false,targetCreated=false;
 const directory=mkdtempSync(join(tmpdir(),'vigia-c13-'));
 try{
  await dst.connect();dstConnected=true;
  // Validate both endpoints are distinct physical PostgreSQL instances.
  const instance=async(db:Db)=> (await db.query(`
   SELECT (SELECT system_identifier::text FROM pg_control_system()) AS system_id`)).rows[0].system_id;
  assert.notEqual(await instance(src),await instance(dst),'destination is same PostgreSQL cluster');
  await preflight(src,'source');
  await preflight(dst,'destination');
  sourceCreated=true;
  targetCreated=true;
  await rolesCreate(src);
  await rolesCreate(dst);
  await src.query(`CREATE SCHEMA ${ns}`);
  await src.query(`CREATE TABLE ${table} (
   id integer PRIMARY KEY,tenant_id integer NOT NULL,
   label text NOT NULL,secret text NOT NULL,
   CONSTRAINT alt0810c13_positive CHECK (tenant_id>0))`);
  await src.query(`INSERT INTO ${table} VALUES
   (1,101,'A','secret-A'),(2,202,'B','secret-B')`);
  await src.query(`CREATE INDEX alt0810c13_tenant_idx ON ${table}(tenant_id)`);
  await src.query(`GRANT USAGE ON SCHEMA ${ns} TO ${reader}`);
  await src.query(`GRANT SELECT(id,tenant_id,label) ON ${table} TO ${reader}`);
  await src.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await src.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  await src.query(`CREATE POLICY alt0810c13_tenant_a ON ${table}
   FOR SELECT TO ${reader} USING (tenant_id=101)`);
  await src.query(`ALTER TABLE ${table} OWNER TO ${owner}`);
  await src.query(`ALTER SCHEMA ${ns} OWNER TO ${owner}`);
  const before=await snapshotDisposableCatalog(src,ns,roles);
  const original=(await src.query(records)).rows;
  const archivePath=join(directory,'cross-instance.dump');
  execPg(['pg_dump','-h','127.0.0.1','-p','5432','-U','vigia_ci',
   '-d','vigia_alt081_ci','-n',ns,'-Fc','-f','/backup/cross-instance.dump'],directory);
  const file=readFileSync(archivePath);
  assert.equal(file.subarray(0,5).toString('ascii'),'PGDMP');
  const checksum=createHash('sha256').update(file).digest('hex');
  execPg(['pg_restore','-h','127.0.0.1','-p','5433','-U','vigia_ci',
   '-d','vigia_alt0810c13_restore_ci','--exit-on-error',
   '--single-transaction','/backup/cross-instance.dump'],directory);
  const restored=await snapshotDisposableCatalog(dst,ns,roles);
  assert.deepEqual(restored,before,'cross-cluster catalog drift after restore');
  assert.deepEqual((await dst.query(records)).rows,original,'cross-cluster data drift after restore');
  // Negative test: deliberate schema and data tampering MUST be detected.
  await dst.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  await dst.query(`UPDATE ${table} SET label='tampered' WHERE id=1`);
  assert.notDeepEqual(await snapshotDisposableCatalog(dst,ns,roles),before,'RLS drift undetected');
  assert.notDeepEqual((await dst.query(records)).rows,original,'data drift undetected');
  // Restore fixture manually to prove a precise verification and NOT hide drift.
  await dst.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await dst.query(`UPDATE ${table} SET label='A' WHERE id=1`);
  assert.deepEqual(await snapshotDisposableCatalog(dst,ns,roles),before);
  assert.deepEqual((await dst.query(records)).rows,original);
  const flags=await dst.query('SELECT rolname,rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=ANY($1::text[])',[roles]);
  assert.equal(flags.rows.length,2);
  assert.ok(flags.rows.every(r=>r.rolsuper===false&&r.rolbypassrls===false&&r.rolcreaterole===false));
  console.log(`ALT0810C13: separate PG16 clusters restored, drift detected, ACL/RLS/data equal; SHA256=${checksum}, production NO-GO`);
 }finally{
  if(dstConnected){await cleanup(dst,targetCreated);await dst.end()}
  await cleanup(src,sourceCreated);
  await src.end();
  rmSync(directory,{recursive:true,force:true});
 }
});
