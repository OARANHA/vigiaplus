/**
 * ALT-08.10C.37 — OFFLINE postgres:16 pg_dump/pg_restore proof, AFTER
 * source COMMIT has deliberately corrupted RLS/ACL/data. Backup taken
 * BEFORE COMMIT is restored into a DIFFERENT disposable PG16 cluster.
 *
 * All credentials, endpoints, role names and SQL target a fixed CI fixture;
 * no user-supplied URLs, Neon, staging, production or operational data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {
  validateC36Plan,readC36Catalog,assertC36Restored,assertC36LeastPrivilege,
  c36CatalogDigest,type C36Catalog,type PgCatalogQuery,
} from '../../lib/db/alt0810c36-preoperational-audit';
import {validateC35Manifest} from '../../lib/db/alt0810c35-operational-manifest';
import {withDisposableScopedRead} from '../../lib/db/alt0810c34-policy-pool-guard';
import {type DedicatedPool} from '../../lib/db/alt0810c33-operational-contract';
const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
   e.ALT0810C37_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
   e.PGPORT!=='5432'||e.PGDATABASE!=='vigia_alt081_ci'||
   e.PGUSER!=='vigia_ci'||e.PGPASSWORD!=='isolated_ci_only'||
   e.ALT0810C37_DEST_HOST!=='127.0.0.1'||
   e.ALT0810C37_DEST_PORT!=='5433'||
   e.ALT0810C37_DEST_DATABASE!=='vigia_alt0810c13_restore_ci'||
   !e.RUNNER_TEMP||e.DATABASE_URL||e.RLS_DATABASE_URL||
   e.NODE_ENV==='production')throw Error('ALT0810C37_TWO_EPHEMERAL_CLUSTERS_ONLY');
const plan=validateC36Plan(JSON.parse(readFileSync(
  'schema/operational-rls/alt0810c36-prestaging-plan.json','utf8',
)) as unknown);
const manifest=validateC35Manifest(JSON.parse(readFileSync(
  'schema/operational-rls/alt0810c35-disposable-manifest.json','utf8',
)) as unknown);
assert.equal(plan.approvedPredicateSourceSha256,manifest.policy.usingSqlSha256);
type Db=PgCatalogQuery&{connect():Promise<void>;end():Promise<void>};
const {Client,Pool}=createRequire(import.meta.url)('pg') as {
 Client:new(config:Record<string,unknown>)=>Db;
 Pool:new(config:Record<string,unknown>)=>DedicatedPool&{end():Promise<void>};
};
const srcCfg={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
 user:'vigia_ci',password:'isolated_ci_only'};
const dstCfg={...srcCfg,port:5433,database:'vigia_alt0810c13_restore_ci'};
const src=new Client(srcCfg),dst=new Client(dstCfg);
const {schema,evidence,readerRole,executorRole,policyName}=plan.scope;
const table=`${schema}.${evidence}`;
const safeCmd=(args:string[],dir:string):string=>execFileSync('docker',[
  'run','--rm','--network','host','--volume',`${dir}:/backup`,
  '--env','PGPASSWORD=isolated_ci_only','postgres:16',...args,
],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
async function rows(db:Db,sql:string,params:unknown[]=[]){
 return(await db.query(sql,params)).rows;
}
async function snapshot(db:Db):Promise<{
  catalog:C36Catalog;records:{id:number;tenantId:number;privateText:string}[];
}>{
 await db.query('BEGIN READ ONLY');
 try{
  const catalog=await readC36Catalog(db,plan);
  const records=(await rows(db,`SELECT id,tenant_id,private_text
    FROM ${table} ORDER BY id`)).map(x=>({
    id:Number(x.id),tenantId:Number(x.tenant_id),
    privateText:String(x.private_text),
  }));
  return{catalog,records};
 }finally{await db.query('ROLLBACK')}
}
async function roleSetup(db:Db){
 await db.query(`CREATE ROLE ${readerRole} NOLOGIN NOSUPERUSER
   NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
 await db.query(`CREATE ROLE ${executorRole} LOGIN PASSWORD 'ci37_reader_only'
   NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
 await db.query(`GRANT ${readerRole} TO ${executorRole}`);
}
async function cleanup(db:Db,created:boolean){
 if(!created)return;
 await db.query('ROLLBACK').catch(()=>{});
 await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(()=>{});
 await db.query(`REVOKE ${readerRole} FROM ${executorRole}`).catch(()=>{});
 await db.query(`DROP ROLE IF EXISTS ${executorRole}`).catch(()=>{});
 await db.query(`DROP ROLE IF EXISTS ${readerRole}`).catch(()=>{});
}
async function tenantIds(cfg:Record<string,unknown>,tenantId:number){
 const pool=new Pool({...cfg,user:executorRole,password:'ci37_reader_only',
    max:1,connectionTimeoutMillis:1500});
 try{
  return await withDisposableScopedRead(pool,{tenantId,readerRole},
    async db=>(await db.query(`SELECT id FROM ${table} ORDER BY id`))
      .rows.map(x=>Number(x.id)));
 }finally{await pool.end()}
}
test('ALT-08.10C.37 post-COMMIT source drift recovers from backup on a DIFFERENT PG16 cluster',
 {timeout:180000},async()=>{
 await src.connect();
 let dstConnected=false,sourceCreated=false,targetCreated=false;
 const dir=mkdtempSync(join(tmpdir(),'vigiaplus-c37-disposable-'));
 try{
  await dst.connect();dstConnected=true;
  const systemId=async(db:Db)=>
    String((await rows(db,'SELECT system_identifier::text AS id FROM pg_control_system()'))[0].id);
  assert.notEqual(await systemId(src),await systemId(dst),
    'source and destination MUST be different PostgreSQL clusters');
  for(const [db,label] of [[src,'src'],[dst,'dst']] as const){
   assert.equal((await rows(db,'SELECT to_regnamespace($1) AS n',[schema]))[0].n,
     null,label+' fixture schema must be absent');
   assert.equal((await rows(db,
     'SELECT rolname FROM pg_roles WHERE rolname IN ($1,$2)',
     [readerRole,executorRole])).length,0,label+' fixture roles must be absent');
  }
  sourceCreated=true;
  await roleSetup(src);
  targetCreated=true;
  await roleSetup(dst);
  await src.query(`CREATE SCHEMA ${schema}`);
  for(const dep of plan.dependencies)
    await src.query(`CREATE TABLE ${schema}.${dep} (id integer)`);
  await src.query(`CREATE TABLE ${table} (
    id integer PRIMARY KEY,tenant_id integer NOT NULL,private_text text NOT NULL)`);
  await src.query(`INSERT INTO ${table}
    VALUES(1,101,'A synthetic'),(2,202,'B synthetic')`);
  await src.query(`CREATE INDEX c37_tenant_idx ON ${table}(tenant_id)`);
  await src.query(`GRANT USAGE ON SCHEMA ${schema} TO ${readerRole},${executorRole}`);
  await src.query(`GRANT SELECT(id,tenant_id) ON ${table} TO ${readerRole}`);
  await src.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await src.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  await src.query(`CREATE POLICY ${policyName} ON ${table}
    AS PERMISSIVE FOR SELECT TO ${readerRole}
    USING(${manifest.policy.usingSql})`);
  const baseline=await snapshot(src);
  assertC36LeastPrivilege(plan,baseline.catalog);
  assert.deepEqual(await tenantIds(srcCfg,101),[1]);
  assert.deepEqual(await tenantIds(srcCfg,202),[2]);
  const oldSha=c36CatalogDigest(baseline.catalog);
  const backupName='/backup/c37-baseline.dump';
  safeCmd(['pg_dump','-h','127.0.0.1','-p','5432','-U','vigia_ci',
    '-d','vigia_alt081_ci','-n',schema,'-Fc','-f',backupName],dir);
  const path=join(dir,'c37-baseline.dump');
  assert.ok(statSync(path).size>0);
  const archive=readFileSync(path);
  assert.equal(archive.subarray(0,5).toString('ascii'),'PGDMP');
  const archiveSha=createHash('sha256').update(archive).digest('hex');
  const listing=safeCmd(['pg_restore','--list',backupName],dir);
  for(const section of ['SCHEMA','TABLE','TABLE DATA','POLICY','ACL','INDEX','CONSTRAINT']){
   assert.ok(listing.includes(section),'archive missing '+section);
  }
  // A damaged archive MUST be refused and cannot be considered valid backup.
  const damaged=join(dir,'corrupted.dump');
  writeFileSync(damaged,Buffer.concat([Buffer.from('NOTPG'),archive.subarray(5)]));
  assert.throws(()=>safeCmd(['pg_restore','--list','/backup/corrupted.dump'],dir),
    /Command failed|status/i,'corrupted backup must fail verification');

  // Commit damage on the SOURCE. The ARCHIVE is already immutable.
  await src.query('BEGIN');
  try{
   await src.query(`ALTER POLICY ${policyName} ON ${table} USING(true)`);
   await src.query(`CREATE POLICY c37_public ON ${table}
     FOR SELECT TO PUBLIC USING(true)`);
   await src.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
   await src.query(`GRANT SELECT(private_text) ON ${table} TO ${readerRole}`);
   await src.query(`GRANT SELECT ON ${schema}.users TO ${readerRole}`);
   await src.query(`UPDATE ${table} SET tenant_id=202,private_text='CORRUPTED'
     WHERE id=1`);
   await src.query('COMMIT');
  }catch(err){await src.query('ROLLBACK');throw err}
  const drifted=await snapshot(src);
  assert.throws(()=>assertC36Restored(baseline.catalog,drifted.catalog),
    /ALT0810C36_CATALOG_DRIFT/);
  assert.throws(()=>assertC36LeastPrivilege(plan,drifted.catalog),
    /ALT0810C36_PREFLIGHT_DENIED/);
  assert.notDeepEqual(drifted.records,baseline.records);
  // Restore into clean DESTINATION AFTER the source COMMIT.
  safeCmd(['pg_restore','-h','127.0.0.1','-p','5433','-U','vigia_ci',
    '-d','vigia_alt0810c13_restore_ci','--single-transaction',
    '--exit-on-error',backupName],dir);
  const restored=await snapshot(dst);
  assertC36LeastPrivilege(plan,restored.catalog);
  assertC36Restored(baseline.catalog,restored.catalog);
  assert.equal(c36CatalogDigest(restored.catalog),oldSha);
  assert.deepEqual(restored.records,baseline.records);
  assert.deepEqual(await tenantIds(dstCfg,101),[1]);
  assert.deepEqual(await tenantIds(dstCfg,202),[2]);
  assert.notDeepEqual((await snapshot(src)).records,restored.records,
    'restoring the isolated target must not rewrite damaged source');
  assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),archiveSha);
  console.log(JSON.stringify({
   gate:'ALT-08.10C.37',sourcePostCommitDrift:true,
   backupFormat:'PGDMP',backupSha256:archiveSha,
   sourceClusterIndependentFromTarget:true,
   restoredCatalogSha256:oldSha,restoredTenantIsolation:true,
   realDatabaseAudited:false,neonTouched:false,
   backupOfOperationalData:false,physicalPitrCertified:false,
  }));
 }finally{
  if(dstConnected){await cleanup(dst,targetCreated);await dst.end()}
  await cleanup(src,sourceCreated);await src.end();
  rmSync(dir,{recursive:true,force:true});
 }
});
