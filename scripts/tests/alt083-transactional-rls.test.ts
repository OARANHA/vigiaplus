/**
 * ALT-08.3 — RLS transactional scope integration against real app table.
 * Runs ONLY on disposable GitHub PostgreSQL CI with migration bootstrap.
 * This tests the optional transaction primitive, not production runtime.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { withTenantRlsTransaction, type TenantSqlPool } from '../../lib/tenant/rls-transaction';

if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'
  ||process.env.ALT083_EPHEMERAL_RLS!=='1'
  ||process.env.PGHOST!=='127.0.0.1'
  ||process.env.PGDATABASE!=='vigia_alt081_ci'
  ||process.env.PGUSER!=='vigia_ci'
  ||process.env.DATABASE_URL) {
  throw new Error('ALT083 transactional integration requires disposable GitHub CI PostgreSQL');
}
const require=createRequire(import.meta.url);
const {Pool}=require('pg') as {Pool:new(options:Record<string,unknown>)=>TenantSqlPool&{
  end():Promise<void>
}};
const connection={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci'};
const admin=new Pool({...connection,user:'vigia_ci',password:process.env.PGPASSWORD,max:2});
const appRole='alt083_tx_app';
const appPassword=randomBytes(24).toString('hex');
const scopedPool=new Pool({...connection,user:appRole,password:appPassword,max:2});
const table='public.notification_deliveries';

test('ALT-08.3: SET LOCAL mantém isolamento por transação e não vaza entre conexões',async()=>{
  const adminConn=await admin.connect();
  let policyInstalled=false;
  let appRoleCreated=false;
  try {
    await adminConn.query(`CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE PASSWORD '${appPassword}'`);
    appRoleCreated=true;
    await adminConn.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`);
    await adminConn.query(`GRANT SELECT ON ${table} TO ${appRole}`);
    const tenantRows=await adminConn.query(`
      INSERT INTO public.tenants(name,slug)
      VALUES ('ALT083 Transaction A','alt083-tx-a'),
             ('ALT083 Transaction B','alt083-tx-b')
      RETURNING id`);
    const ta=Number(tenantRows.rows[0].id),tb=Number(tenantRows.rows[1].id);
    await adminConn.query(`INSERT INTO ${table}
      (tenant_id,channel,destination,kind,title,message,status,dedupe_key)
      VALUES ($1,'ledger','internal','test','tx A','ALT083_TX_A','queued','alt083-tx-a'),
             ($2,'ledger','internal','test','tx B','ALT083_TX_B','queued','alt083-tx-b')`,
      [ta,tb]);
    await adminConn.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await adminConn.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await adminConn.query(`CREATE POLICY alt083_tx_scope ON ${table}
      FOR SELECT USING (
        tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer
      )`);
    policyInstalled=true;
    // Leitura com role própria de aplicação; usuário admin/superuser poderia
    // ignorar RLS mesmo com FORCE, portanto não serve como evidência.
    const appConn=await scopedPool.connect();
    const unauth=await appConn.query(`SELECT tenant_id FROM ${table}
      WHERE tenant_id IN ($1,$2)`,[ta,tb]);
    assert.equal(unauth.rows.length,0,'ausência de app.tenant_id nega acesso');
    appConn.release();
    const a=await withTenantRlsTransaction(scopedPool,ta,async query=>{
      const rows=await query(`SELECT tenant_id,message FROM ${table}
        WHERE tenant_id IN ($1,$2)`,[ta,tb]);
      return rows.rows;
    });
    assert.deepEqual(a.map(r=>r.message),['ALT083_TX_A']);
    const b=await withTenantRlsTransaction(scopedPool,tb,async query=>{
      const rows=await query(`SELECT tenant_id,message FROM ${table}
        WHERE tenant_id IN ($1,$2)`,[ta,tb]);
      return rows.rows;
    });
    assert.deepEqual(b.map(r=>r.message),['ALT083_TX_B']);
    const appAfter=await scopedPool.connect();
    const after=await appAfter.query(`SELECT tenant_id FROM ${table}
      WHERE tenant_id IN ($1,$2)`,[ta,tb]);
    assert.equal(after.rows.length,0,'SET LOCAL não persiste após COMMIT');
    appAfter.release();
    await assert.rejects(withTenantRlsTransaction(scopedPool,ta,async query=>{
      const visible=await query(`SELECT message FROM ${table}
        WHERE tenant_id IN ($1,$2)`,[ta,tb]);
      assert.deepEqual(visible.rows.map(r=>r.message),['ALT083_TX_A']);
      throw new Error('controlled rollback');
    }),/controlled rollback/);
    const appAfterRollback=await scopedPool.connect();
    const afterRollback=await appAfterRollback.query(`SELECT tenant_id FROM ${table}
      WHERE tenant_id IN ($1,$2)`,[ta,tb]);
    assert.equal(afterRollback.rows.length,0);
    appAfterRollback.release();
    process.stdout.write('ALT083: transaction-local tenant scope isolated in disposable PostgreSQL\n');
  } finally {
    if(policyInstalled) {
      await adminConn.query(`DROP POLICY IF EXISTS alt083_tx_scope ON ${table}`);
      await adminConn.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
      await adminConn.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    }
    adminConn.release();
    await scopedPool.end();
    if(appRoleCreated) {
      const adminCleanup=await admin.connect();
      try {
        await adminCleanup.query(`DROP OWNED BY ${appRole}`);
        await adminCleanup.query(`DROP ROLE IF EXISTS ${appRole}`);
      } finally {adminCleanup.release();}
    }
    await admin.end();
  }
});
