/**
 * ALT-08.7 — staging Neon WebSocket: preflight não destrutivo.
 * Fails closed unless the connection is the dedicated ALT-08.7 staging database.
 * NÃO modifica RLS, grants, tabela ou produção.
 */
import assert from 'node:assert/strict';
import {withNeonRlsPool} from '../../lib/tenant/neon-rls-adapter';
import {withTenantRlsTransaction} from '../../lib/tenant/rls-transaction';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.NODE_ENV==='production'||
   e.VIGIA_RLS_MODE!=='ci-experimental'||e.DATABASE_URL||
   e.ALT087_STAGING_CONFIRM!=='VIGIAPLUS_ISOLATED_ALT086_STAGING'||
   !e.RLS_DATABASE_URL||!/^\d+$/.test(e.GITHUB_RUN_ID??'')){
  throw Error('ALT087_STAGING_EXPLICIT_CI_ONLY');
}
const u=new URL(e.RLS_DATABASE_URL);
const db=decodeURIComponent(u.pathname.slice(1));
if(!['postgres:','postgresql:'].includes(u.protocol)||
   !u.hostname.endsWith('.neon.tech')||
   db!=='vigia_alt086_staging_20261112') {
  throw Error('ALT087_REFUSE_NON_STAGING_CONNECTION');
}
async function main():Promise<void>{
  await withNeonRlsPool(e,async pool=>{
    const c=await pool.connect();
    try{
      const x=await c.query(`SELECT current_database() AS db,current_user AS role,
        (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass,
        (SELECT count(*)::int FROM pg_policies WHERE schemaname='public') AS policies`);
      assert.equal(x.rows.length,1);
      assert.equal(x.rows[0].db,'vigia_alt086_staging_20261112');
      assert.equal(x.rows[0].superuser,false,'superuser staging denied');
      assert.equal(x.rows[0].bypass,false,'BYPASSRLS staging denied');
      // Do not change a database if the schema already carries active policies.
      assert.equal(Number(x.rows[0].policies),0,'unexpected staging policies');
    }finally{c.release();}
    // Real Neon WS pool, isolated pinned transaction, SET LOCAL/ROLLBACK/COMMIT.
    const own=await withTenantRlsTransaction(pool,771,async q=>{
      const x=await q(`SELECT current_setting('app.tenant_id',true) AS tenant`);
      return x.rows[0]?.tenant;
    });
    assert.equal(own,'771');
    const next=await withTenantRlsTransaction(pool,882,async q=>{
      const x=await q(`SELECT current_setting('app.tenant_id',true) AS tenant`);
      return x.rows[0]?.tenant;
    });
    assert.equal(next,'882');
    await assert.rejects(withTenantRlsTransaction(pool,993,async q=>{
      const r=await q(`SELECT current_setting('app.tenant_id',true) AS tenant`);
      assert.equal(r.rows[0]?.tenant,'993');
      throw Error('ALT087_FORCED_ROLLBACK');
    }),/ALT087_FORCED_ROLLBACK/);
    const c=await pool.connect();
    try{
      const r=await c.query(`SELECT nullif(current_setting('app.tenant_id',true),'') AS tenant`);
      assert.equal(r.rows[0]?.tenant,null,'transaction scope leaked to next session');
    }finally{c.release();}
    process.stdout.write('ALT087 isolated staging: real Neon WS transactional A/B, rollback and no leak VERIFIED\\n');
  });
}
main().catch(error=>{
  console.error('ALT087 staging NO-GO:',error instanceof Error?error.message:'unknown');
  process.exitCode=1;
});
