/**
 * ALT-08.3 — E2E REAL Neon WebSocket, exclusivo de banco VAZIO e descartável.
 *
 * Manual workflow_dispatch only. Never use a production database/branch.
 * Does not call getDb(), send notifications, seed product data or modify
 * existing schemas. Expects a dedicated Neon DB named vigia_alt083_ci_*.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { withNeonRlsPool } from '../../lib/tenant/neon-rls-adapter';
import { withAuthenticatedClientRls } from '../../lib/tenant/rls-runtime';
import type { TenantContext } from '../../lib/tenant/context';
import type { TenantSqlPool } from '../../lib/tenant/rls-transaction';

const env=process.env;
if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true'
    || env.VIGIA_RLS_MODE !== 'ci-experimental'
    || env.VIGIA_ALT083_DISPOSABLE_CONFIRM !== 'YES-EMPTY-NEON-CI-DATABASE'
    || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')
    || env.NODE_ENV === 'production' || env.DATABASE_URL
    || !env.RLS_DATABASE_URL) {
  throw new Error('ALT083_NEON_E2E_DISPOSABLE_ONLY');
}
const name='alt083_ws_'+env.GITHUB_RUN_ID;
const table=name+'.deliveries';

function tenantContext(tenantId:number):TenantContext {
  return {
    userId:9001,userName:'Neon E2E synthetic client',
    role:'client_viewer',tenantId,system:false,surface:'app',
    density:'basico',vocabulary:'leigo',ip:null,
    requestId:'alt083-neon-e2e',
  };
}
async function withAdmin<T>(operation:(pool:TenantSqlPool)=>Promise<T>):Promise<T> {
  return withNeonRlsPool(env,operation);
}
test('ALT-08.3 Neon WS: db descartável, RLS entre tenants, COMMIT/ROLLBACK e cleanup',async()=>{
  let schemaCreated=false;
  // First do preflight READ-ONLY. No DDL unless the database has the exact
  // CI naming convention and contains no user-created tables anywhere.
  await withAdmin(async pool=>{
    const conn=await pool.connect();
    try {
      const id=await conn.query(`SELECT current_database() AS db,
         current_user AS role, pg_backend_pid() AS pid`);
      const db=String(id.rows[0].db);
      assert.match(db,/^vigia_alt083_ci_[a-z0-9_]+$/,'not a dedicated CI database');
      const user=String(id.rows[0].role);
      const flags=await conn.query(`SELECT rolsuper,rolbypassrls
        FROM pg_roles WHERE rolname=$1`,[user]);
      assert.equal(flags.rows.length,1);
      assert.equal(flags.rows[0].rolsuper,false,'superuser prohibited');
      assert.equal(flags.rows[0].rolbypassrls,false,'BYPASSRLS prohibited');
      const count=await conn.query(`SELECT count(*) AS n FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog','information_schema')
          AND schemaname NOT LIKE 'pg_toast%'`);
      assert.equal(Number(count.rows[0].n),0,'refuse non-empty database');
      assert.ok(Number(id.rows[0].pid)>0,'real PostgreSQL connection required');
    }finally{conn.release();}
  });
  try {
    await withAdmin(async pool=>{
      const conn=await pool.connect();
      try {
        await conn.query(`CREATE SCHEMA ${name}`);
        schemaCreated=true;
        await conn.query(`CREATE TABLE ${table}
          (id integer PRIMARY KEY,tenant_id integer NOT NULL,message text NOT NULL)`);
        await conn.query(`INSERT INTO ${table} VALUES
          (1,101,'ALT083_WS_A'),(2,202,'ALT083_WS_B')`);
        await conn.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
        await conn.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
        await conn.query(`CREATE POLICY alt083_scope ON ${table} FOR ALL
          USING (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer)
          WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer)`);
        const missing=await conn.query(`SELECT id FROM ${table}`);
        assert.equal(missing.rows.length,0,'without tenant scope deny all');
      }finally{conn.release();}
    });
    const observed:number[]=[];
    for(const [tenant,expected] of [[101,1],[202,2]] as const){
      const rows=await withAdmin(pool=>withAuthenticatedClientRls(
        tenantContext(tenant),pool,
        async query=>(await query(`SELECT id FROM ${table} ORDER BY id`)).rows));
      assert.deepEqual(rows.map(r=>Number(r.id)),[expected]);
      observed.push(Number(rows[0].id));
    }
    assert.deepEqual(observed,[1,2]);
    await assert.rejects(withAdmin(pool=>withAuthenticatedClientRls(
      tenantContext(101),pool,async query=>{
        const n=await query(`UPDATE ${table} SET message='ROLLBACK_SENTINEL'
          WHERE id=1`);
        assert.equal(n.rowCount,1);
        throw new Error('ALT083_EXPECTED_ROLLBACK');
      })),/ALT083_EXPECTED_ROLLBACK/);
    const readAfter=await withAdmin(pool=>withAuthenticatedClientRls(
      tenantContext(101),pool,
      async query=>(await query(`SELECT message FROM ${table} WHERE id=1`)).rows));
    assert.equal(readAfter[0].message,'ALT083_WS_A','rollback must preserve original value');
    await withAdmin(async pool=>{
      const c=await pool.connect();
      try {
        const noLeak=await c.query(`SELECT id FROM ${table}`);
        assert.equal(noLeak.rows.length,0,'SET LOCAL must not leak across operations');
      }finally{c.release();}
    });
    process.stdout.write('ALT083 Neon WebSocket E2E: RLS A/B, rollback and no scope leak VERIFIED\n');
  }finally{
    if(schemaCreated){
      // The schema name is constructed only from the numeric GitHub run ID.
      await withAdmin(async pool=>{
        const c=await pool.connect();
        try{await c.query(`DROP SCHEMA IF EXISTS ${name} CASCADE`);}
        finally{c.release();}
      });
    }
  }
});
