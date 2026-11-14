/**
 * ALT-08.10C.12: real pg_dump/pg_restore (PostgreSQL 16 -> independent,
 * freshly-created local database). CI-only disposable fixture.
 *
 * Neither migration runner, remote DATABASE_URL, Neon, nor production is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshotDisposableCatalog} from '../../lib/db/disposable-catalog-snapshot';

const env=process.env;
if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||
  env.ALT0810C12_EPHEMERAL!=='1'||env.PGHOST!=='127.0.0.1'||
  env.PGPORT!=='5432'||env.PGDATABASE!=='vigia_alt081_ci'||
  env.PGUSER!=='vigia_ci'||env.PGPASSWORD!=='isolated_ci_only'||
  env.DATABASE_URL||env.RLS_DATABASE_URL||env.NODE_ENV==='production'||
  env.RUNNER_OS!=='Linux')
 throw Error('ALT0810C12_LOCAL_GITHUB_POSTGRES16_ONLY');

type Result={rows:Record<string,unknown>[];rowCount:number|null};
type PgClient={connect():Promise<void>;query(s:string,p?:unknown[]):Promise<Result>;end():Promise<void>};
const {Client}=createRequire(import.meta.url)('pg') as
 {Client:new(options:Record<string,unknown>)=>PgClient};
const connection={host:'127.0.0.1',port:5432,user:'vigia_ci',password:'isolated_ci_only'};
const source=new Client({...connection,database:'vigia_alt081_ci'});
const destination=new Client({...connection,database:'vigia_alt0810c12_restored_ci'});
const catalogDb='vigia_alt081_ci';
const restoreDb='vigia_alt0810c12_restored_ci';
const ns='alt0810c6_backup_c12';
const owner='alt0810c6_backup_owner';
const reader='alt0810c6_backup_reader';
const roles=[owner,reader];
const table=`${ns}.tenant_records`;
const initialRows=[
 {id:1,tenant_id:101,label:'tenant A',secret:'private A'},
 {id:2,tenant_id:202,label:'tenant B',secret:'private B'},
];
const readRows=(db:PgClient)=>db.query(
 `SELECT id,tenant_id,label,secret FROM ${table} ORDER BY id`);
function pg16(args:readonly string[],directory:string):string{
 // The same official PostgreSQL:16 client image as the CI service.
 // Fixed container networking + mount; argv is never shell-interpolated.
 return execFileSync('docker',[
  'run','--rm','--network','host','--volume',`${directory}:/backup`,
  '--env','PGPASSWORD=isolated_ci_only','postgres:16',...args,
 ],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
}

test('ALT-08.10C.12 pg_dump/pg_restore recovers data, owners, grants, RLS and policies',async()=>{
 await source.connect();
 let setupStarted=false,restoreCreated=false,destinationConnected=false;
 const directory=mkdtempSync(join(tmpdir(),'vigia-alt0810c12-'));
 try{
  const foundSchema=await source.query('SELECT to_regnamespace($1) AS result',[ns]);
  assert.equal(foundSchema.rows[0]?.result,null,'source fixture already exists');
  const foundRoles=await source.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[roles]);
  assert.equal(foundRoles.rows.length,0,'fixture roles already exist');
  const foundDb=await source.query('SELECT datname FROM pg_database WHERE datname=$1',[restoreDb]);
  assert.equal(foundDb.rows.length,0,'destination DB already exists');
  setupStarted=true;
  await source.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE`);
  await source.query(`CREATE ROLE ${reader} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE`);
  await source.query(`CREATE SCHEMA ${ns}`);
  await source.query(`CREATE TABLE ${table}(
    id integer PRIMARY KEY,
    tenant_id integer NOT NULL,
    label text NOT NULL,
    secret text NOT NULL,
    CONSTRAINT alt0810c12_positive CHECK (tenant_id>0))`);
  await source.query(`INSERT INTO ${table} VALUES
    (1,101,'tenant A','private A'),(2,202,'tenant B','private B')`);
  await source.query(`CREATE INDEX alt0810c12_tenant_idx ON ${table}(tenant_id)`);
  await source.query(`GRANT USAGE ON SCHEMA ${ns} TO ${reader}`);
  await source.query(`GRANT SELECT(id,tenant_id,label) ON ${table} TO ${reader}`);
  await source.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await source.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  await source.query(`CREATE POLICY alt0810c12_reader ON ${table}
    FOR SELECT TO ${reader} USING (tenant_id=101)`);
  await source.query(`ALTER TABLE ${table} OWNER TO ${owner}`);
  await source.query(`ALTER SCHEMA ${ns} OWNER TO ${owner}`);

  const before=await snapshotDisposableCatalog(source,ns,roles);
  assert.ok(before.relations.some(x=>x.includes(owner)));
  assert.ok(before.policies.some(x=>x.includes('alt0810c12_reader')));
  assert.ok(before.columnGrants.some(x=>x.includes(reader)));
  assert.ok(before.indexes.some(x=>x.includes('alt0810c12_tenant_idx')));
  assert.deepEqual((await readRows(source)).rows,initialRows);

  const path=join(directory,'source.dump');
  pg16(['pg_dump','--host','127.0.0.1','--port','5432','--username','vigia_ci',
    '--dbname',catalogDb,'--schema',ns,'--format','custom','--file','/backup/source.dump'],directory);
  const archive=readFileSync(path);
  assert.ok(statSync(path).size>0,'empty backup');
  assert.equal(archive.subarray(0,5).toString('ascii'),'PGDMP');
  const backupSha256=createHash('sha256').update(archive).digest('hex');
  const listing=pg16(['pg_restore','--list','/backup/source.dump'],directory);
  for(const expected of ['SCHEMA','TABLE','TABLE DATA','POLICY','ACL','INDEX','CONSTRAINT'])
   assert.ok(listing.includes(expected),`archive lacks ${expected}`);
  assert.ok(listing.includes(ns));

  // Restore in another DB on same disposable PG16 service, with exact roles.
  await source.query(`CREATE DATABASE ${restoreDb}`);
  restoreCreated=true;
  pg16(['pg_restore','--host','127.0.0.1','--port','5432',
    '--username','vigia_ci','--dbname',restoreDb,
    '--exit-on-error','--single-transaction','/backup/source.dump'],directory);

  await destination.connect();destinationConnected=true;
  const after=await snapshotDisposableCatalog(destination,ns,roles);
  assert.deepEqual(after,before,'pg_restore catalog differs: owner/ACL/RLS/policy/constraint/index');
  assert.deepEqual((await readRows(destination)).rows,initialRows,'restored rows differ');
  const actualOwner=await destination.query(`SELECT pg_get_userbyid(relowner) AS owner,
   relrowsecurity AS rls,relforcerowsecurity AS forced
   FROM pg_class WHERE oid=$1::regclass`,[table]);
  assert.deepEqual(actualOwner.rows,[{owner,rls:true,forced:true}]);
  const policyCount=await destination.query(
   'SELECT count(*)::int AS n FROM pg_policies WHERE schemaname=$1 AND tablename=$2',
   [ns,'tenant_records']);
  assert.equal(policyCount.rows[0].n,1);
  console.log(`ALT0810C12: real PG16 custom dump + single-transaction restore verified bytes=${archive.length} sha256=${backupSha256}; operations on disposable databases ONLY`);
 }finally{
  if(destinationConnected)await destination.end();
  if(restoreCreated)await source.query(`DROP DATABASE IF EXISTS ${restoreDb} WITH (FORCE)`).catch(()=>{});
  if(setupStarted){
   await source.query(`DROP TABLE IF EXISTS ${table}`).catch(()=>{});
   await source.query(`DROP SCHEMA IF EXISTS ${ns}`).catch(()=>{});
   for(const role of [...roles].reverse())
    await source.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
  }
  await source.end();
  rmSync(directory,{recursive:true,force:true});
 }
});
