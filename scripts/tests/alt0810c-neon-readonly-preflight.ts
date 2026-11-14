/**
 * ALT-08.10C: inspection-only catalog preflight in the dedicated Neon branch.
 * No getDb(), bootstrap, migrator role, migrations or DDL.
 * Transaction is READ ONLY; PostgreSQL rejects writes even if SQL regresses.
 */
import assert from 'node:assert/strict';
import {withNeonRlsPool} from '../../lib/tenant/neon-rls-adapter';
import {
 assertStagingReadOnlyEnv,assertIsolatedStagingCatalog,
 operationalSchemaReadiness,type StagingCatalog,
} from '../../lib/db/staging-schema-preflight';

async function main(){
 assertStagingReadOnlyEnv(process.env);
 await withNeonRlsPool(process.env,async pool=>{
  const c=await pool.connect();
  try{
   await c.query('BEGIN READ ONLY');
   try{
    const result=await c.query(`SELECT
      current_database() AS database,
      current_user AS role,
      (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass_rls,
      (SELECT count(*)::int FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND t.relkind IN ('r','p')) AS public_tables,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='public') AS public_policies,
      (SELECT count(*)::int FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND t.relkind IN ('i','I')) AS public_indexes,
      (SELECT count(*)::int FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace
        WHERE n.nspname='public') AS public_constraints,
      (SELECT count(*)::int FROM information_schema.role_table_grants
        WHERE table_schema='public') AS public_grants,
      (SELECT EXISTS (SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname='public' AND t.relname='schema_migrations' AND t.relkind='r')) AS migration_ledger`);
    assert.equal(result.rows.length,1);
    const r=result.rows[0];
    const cat:StagingCatalog={
      database:String(r.database),role:String(r.role),
      superuser:r.superuser===true,bypassRls:r.bypass_rls===true,
      publicTables:Number(r.public_tables),
      publicPolicies:Number(r.public_policies),
      publicIndexes:Number(r.public_indexes),
      publicConstraints:Number(r.public_constraints),
      publicGrants:Number(r.public_grants),
      migrationLedger:r.migration_ledger===true,
    };
    assertIsolatedStagingCatalog(cat);
    const state=operationalSchemaReadiness(cat);
    // This is catalog-only metadata: no schema/table contents, identities or secrets.
    console.log('ALT0810C NEON READ ONLY CATALOG: '+JSON.stringify({...cat,...state}));
    assert.equal(state.migratorAllowed,false);
    assert.equal(state.productionAllowed,false);
    console.log('ALT0810C: NO DDL, NO BOOTSTRAP, NO DB WRITES VERIFIED');
    await c.query('ROLLBACK');
   }catch(e){await c.query('ROLLBACK');throw e}
  }finally{c.release()}
 });
}
main().catch(e=>{
 console.error('ALT0810C PREFLIGHT NO-GO:',e instanceof Error?e.message:'unknown');
 process.exitCode=1;
});
