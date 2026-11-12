/**
 * ALT-08.7 — ensaio real no Neon STAGING exclusivo: DDL reversível + leitura RLS.
 * Só roda por workflow_dispatch com DOIS secrets de staging, nunca produção.
 * Migração usa role owner apenas para DDL; assertions de isolamento usam reader
 * SEM SUPERUSER/BYPASSRLS. Não toca tabelas public, auth ou tenant operacional.
 */
import assert from 'node:assert/strict';
import {withNeonRlsPool} from '../../lib/tenant/neon-rls-adapter';
import {withTenantRlsTransaction} from '../../lib/tenant/rls-transaction';
import type {TenantSqlPool,TenantSqlClient} from '../../lib/tenant/rls-transaction';

const env=process.env;
const STAGING_DB='vigia_alt086_staging_20261112';
const SCHEMA='alt087_staging_e2e';
const READ_ROLE='vigia_alt087_staging_reader';
const OWNER_ROLE='vigia_alt083_ci_20261112_owner';

function checkUrl(raw:string|undefined,role:string):string {
  if(!raw)throw Error('ALT087_STAGING_CREDENTIAL_REQUIRED');
  const u=new URL(raw);
  if(!['postgres:','postgresql:'].includes(u.protocol)||
     !u.hostname.endsWith('.neon.tech')||
     decodeURIComponent(u.pathname.slice(1))!==STAGING_DB||
     decodeURIComponent(u.username)!==role){
    throw Error('ALT087_STAGING_DB_OR_ROLE_MISMATCH');
  }
  return u.hostname;
}
function guard():void{
  if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.NODE_ENV==='production'||
     env.VIGIA_RLS_MODE!=='ci-experimental'||env.DATABASE_URL||
     env.ALT087_STAGING_CONFIRM!=='VIGIAPLUS_ISOLATED_ALT086_STAGING'||
     env.ALT087_MIGRATION_CONFIRM!=='REVERSIBLE_SYNTHETIC_SCHEMA_ONLY'||
     !/^\d+$/.test(env.GITHUB_RUN_ID??'')){
    throw Error('ALT087_STAGING_MIGRATION_NOT_AUTHORIZED');
  }
  const host=checkUrl(env.RLS_DATABASE_URL,READ_ROLE);
  assert.equal(checkUrl(env.ALT087_STAGING_MIGRATOR_URL,OWNER_ROLE),host,
    'staging owner and reader must point to same endpoint');
}
type Q=TenantSqlClient['query'];
async function catalog(query:Q){
  const r=await query(`SELECT
    (SELECT count(*)::int FROM pg_namespace WHERE nspname='${SCHEMA}') AS schemas,
    (SELECT count(*)::int FROM pg_tables WHERE schemaname='${SCHEMA}') AS tables,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='${SCHEMA}') AS policies`);
  return {
    schemas:Number(r.rows[0]?.schemas),
    tables:Number(r.rows[0]?.tables),
    policies:Number(r.rows[0]?.policies),
  };
}
async function verifyReader(pool:TenantSqlPool):Promise<void>{
  const c=await pool.connect();
  try{
    const info=await c.query(`SELECT current_database() AS db,current_user AS role,
      (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass`);
    assert.equal(info.rows[0]?.db,STAGING_DB);
    assert.equal(info.rows[0]?.role,READ_ROLE);
    assert.equal(info.rows[0]?.superuser,false);
    assert.equal(info.rows[0]?.bypass,false);
    assert.equal((await c.query(`SELECT id FROM ${SCHEMA}.evidence`)).rows.length,0,
      'missing scope must deny all');
    await assert.rejects(c.query(`SELECT private_payload FROM ${SCHEMA}.evidence`),
      /permission denied|42501/i,'sensitive field denied');
  }finally{c.release();}
  for(const [id,expected] of [[771,101],[882,202],[771,101]] as const){
    const r=await withTenantRlsTransaction(pool,id,q=>q(
      `SELECT id FROM ${SCHEMA}.evidence ORDER BY id`));
    assert.deepEqual(r.rows.map(x=>Number(x.id)),[expected]);
  }
  await assert.rejects(withTenantRlsTransaction(pool,771,async q=>{
    const r=await q(`SELECT id FROM ${SCHEMA}.evidence`);
    assert.deepEqual(r.rows.map(x=>Number(x.id)),[101]);
    throw Error('ALT087_FORCED_ROLLBACK');
  }),/ALT087_FORCED_ROLLBACK/);
  await assert.rejects(withTenantRlsTransaction(pool,771,q=>q(
    `UPDATE ${SCHEMA}.evidence SET tenant_id=882 WHERE id=101`)),
    /permission denied|42501/i,'read-only role cannot write');
  const after=await pool.connect();
  try {
    const r=await after.query(`SELECT id FROM ${SCHEMA}.evidence`);
    assert.equal(r.rows.length,0,'tenant context leaked after rollback');
  }finally{after.release();}
}
async function migrate(owner:TenantSqlPool):Promise<void>{
  const c=await owner.connect();
  try{
    const info=await c.query(`SELECT current_database() AS db,current_user AS role`);
    assert.equal(info.rows[0]?.db,STAGING_DB);
    assert.equal(info.rows[0]?.role,OWNER_ROLE);
    assert.deepEqual(await catalog(c.query.bind(c)),{schemas:0,tables:0,policies:0},
      'staging schema already exists; refusing migration');
    await c.query('BEGIN');
    try{
      await c.query(`CREATE SCHEMA ${SCHEMA}`);
      await c.query(`CREATE TABLE ${SCHEMA}.evidence (
        id integer PRIMARY KEY,tenant_id integer NOT NULL,
        label text NOT NULL, private_payload text NOT NULL)`);
      await c.query(`INSERT INTO ${SCHEMA}.evidence VALUES
        (101,771,'synthetic A','PII_A'),(202,882,'synthetic B','PII_B')`);
      await c.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${READ_ROLE}`);
      await c.query(`GRANT SELECT (id,label) ON TABLE ${SCHEMA}.evidence TO ${READ_ROLE}`);
      await c.query(`ALTER TABLE ${SCHEMA}.evidence ENABLE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE ${SCHEMA}.evidence FORCE ROW LEVEL SECURITY`);
      await c.query(`CREATE POLICY alt087_read ON ${SCHEMA}.evidence
        AS PERMISSIVE FOR SELECT TO ${READ_ROLE}
        USING (tenant_id=NULLIF(current_setting('app.tenant_id',true),'')::integer)`);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}
  }finally{c.release();}
}
async function cleanup(owner:TenantSqlPool):Promise<void>{
  const c=await owner.connect();
  try{
    const state=await catalog(c.query.bind(c));
    if(state.schemas===0){
      assert.deepEqual(state,{schemas:0,tables:0,policies:0});
      return;
    }
    assert.deepEqual(state,{schemas:1,tables:1,policies:1},
      'cleanup refused: staging schema has unexpected objects');
    const own=await c.query(`SELECT tablename,policyname
      FROM pg_policies WHERE schemaname='${SCHEMA}'`);
    assert.equal(own.rows[0]?.tablename,'evidence');
    assert.equal(own.rows[0]?.policyname,'alt087_read');
    await c.query('BEGIN');
    try{
      // All objects were uniquely created in this CI run in the schema named above.
      await c.query(`DROP POLICY alt087_read ON ${SCHEMA}.evidence`);
      await c.query(`ALTER TABLE ${SCHEMA}.evidence NO FORCE ROW LEVEL SECURITY`);
      await c.query(`ALTER TABLE ${SCHEMA}.evidence DISABLE ROW LEVEL SECURITY`);
      await c.query(`REVOKE SELECT (id,label) ON TABLE ${SCHEMA}.evidence FROM ${READ_ROLE}`);
      await c.query(`REVOKE USAGE ON SCHEMA ${SCHEMA} FROM ${READ_ROLE}`);
      await c.query(`DROP TABLE ${SCHEMA}.evidence`);
      await c.query(`DROP SCHEMA ${SCHEMA}`);
      await c.query('COMMIT');
    }catch(e){await c.query('ROLLBACK');throw e;}
    assert.deepEqual(await catalog(c.query.bind(c)),{schemas:0,tables:0,policies:0},
      'staging baseline must be fully restored');
  }finally{c.release();}
}
async function main():Promise<void>{
  guard();
  const ownerEnv={...env,RLS_DATABASE_URL:env.ALT087_STAGING_MIGRATOR_URL};
  await withNeonRlsPool(ownerEnv,async owner=>{
    let created=false;
    try{
      await migrate(owner);
      created=true;
      await withNeonRlsPool(env,verifyReader);
      process.stdout.write('ALT087 STAGING: WS tenant A/B/A, denied PII/write, rollback VERIFIED\\n');
    }finally{
      // Even on test failure, restore the isolated schema; cleanup failure fails CI.
      if(created)await cleanup(owner);
    }
    process.stdout.write('ALT087 STAGING: synthetic migration and complete catalog rollback VERIFIED\\n');
  });
}
main().catch(e=>{
  console.error('ALT087 STAGING NO-GO:',e instanceof Error?e.message:'unknown');
  process.exitCode=1;
});
