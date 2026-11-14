/**
 * ALT-08.10C.7 — reversible *post-COMMIT* change rehearsal.
 * Dedicated PostgreSQL 16 service in GitHub Actions ONLY.
 * Does not touch migrations, application DB, Neon or staging.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {snapshotDisposableCatalog} from '../../lib/db/disposable-catalog-snapshot';

const env=process.env;
if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.ALT0810C7_EPHEMERAL!=='1'||
  env.PGHOST!=='127.0.0.1'||env.PGPORT!=='5432'||
  env.PGDATABASE!=='vigia_alt081_ci'||env.PGUSER!=='vigia_ci'||
  env.PGPASSWORD!=='isolated_ci_only'||env.DATABASE_URL||
  env.RLS_DATABASE_URL||env.NODE_ENV==='production')
  throw Error('ALT0810C7_DISPOSABLE_POSTGRES_ONLY');

type Result={rows:Record<string,unknown>[];rowCount:number|null};
type Client={connect():Promise<void>;query(s:string,params?:unknown[]):Promise<Result>;end():Promise<void>};
const {Client:PgClient}=createRequire(import.meta.url)('pg') as {
  Client:new(options:Record<string,unknown>)=>Client
};
const connection={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
  user:'vigia_ci',password:'isolated_ci_only'};
const admin=new PgClient(connection);
const namespace='alt0810c6_postcommit';
const migrator='alt0810c6_migrator';
const runtime='alt0810c6_runtime';
const reader='alt0810c6_reader_c7';
const roles=[migrator,runtime,reader];
const table=namespace+'.evidence';
const policyReader='alt0810c7_read';
const policyUpdate='alt0810c7_update';
const index='alt0810c7_tenant_idx';
const rowSql=`SELECT id,tenant_id,label,private_note FROM ${table} ORDER BY id`;
const readPolicy=`CREATE POLICY ${policyReader} ON ${table}
 FOR SELECT TO ${reader},${runtime} USING (tenant_id=771)`;
const updatePolicy=`CREATE POLICY ${policyUpdate} ON ${table}
 FOR UPDATE TO ${runtime} USING (tenant_id=771) WITH CHECK (tenant_id=771)`;

test('ALT-08.10C.7: COMMIT then explicit compensating transaction restores catalog and data',async()=>{
  await admin.connect();
  let setupStarted=false,tx=false;
  try {
    // Never perform cleanup when the namespace or any role already existed.
    const schemaExists=await admin.query('SELECT to_regnamespace($1) AS ns',[namespace]);
    assert.equal(schemaExists.rows[0]?.ns,null,'namespace collision');
    const roleExists=await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])',[roles]);
    assert.equal(roleExists.rows.length,0,'role collision');
    setupStarted=true;

    for(const role of roles)
      await admin.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS
        NOCREATEROLE NOCREATEDB NOREPLICATION`);
    await admin.query(`CREATE SCHEMA ${namespace}`);
    await admin.query(`CREATE TABLE ${table}(
      id integer PRIMARY KEY,tenant_id integer NOT NULL,
      label text NOT NULL,private_note text NOT NULL,
      CONSTRAINT alt0810c7_positive CHECK(tenant_id>0))`);
    await admin.query(`INSERT INTO ${table} VALUES
      (1,771,'original A','private A'),(2,882,'original B','private B')`);
    await admin.query(`CREATE INDEX ${index} ON ${table}(tenant_id)`);
    await admin.query(`ALTER TABLE ${table} OWNER TO ${migrator}`);
    await admin.query(`GRANT USAGE ON SCHEMA ${namespace} TO ${runtime},${reader}`);
    await admin.query(`GRANT SELECT(id,label) ON ${table} TO ${reader}`);
    await admin.query(`GRANT SELECT(id,label),UPDATE(label) ON ${table} TO ${runtime}`);
    await admin.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await admin.query(readPolicy);
    await admin.query(updatePolicy);

    const baseline=await snapshotDisposableCatalog(admin,namespace,roles);
    const data=(await admin.query(rowSql)).rows;
    assert.equal(baseline.roles.length,3);
    assert.ok(baseline.relations.some(x=>x.includes(migrator)));
    assert.ok(baseline.policies.some(x=>x.includes(policyReader)));
    assert.ok(baseline.indexes.some(x=>x.includes(index)));
    assert.ok(baseline.columnGrants.some(x=>x.includes(reader)));

    // Demonstrate distinct least-privileged identities before the migration.
    await admin.query(`SET ROLE ${reader}`);
    try {
      const own=await admin.query(`SELECT id,label FROM ${table} ORDER BY id`);
      assert.deepEqual(own.rows.map(x=>Number(x.id)),[1]);
      await assert.rejects(admin.query(`SELECT private_note FROM ${table}`));
      await assert.rejects(admin.query(`UPDATE ${table} SET label='denied' WHERE id=1`));
    }finally{await admin.query('RESET ROLE')}
    await admin.query('BEGIN');tx=true;
    await admin.query(`SET LOCAL ROLE ${runtime}`);
    const updated=await admin.query(`UPDATE ${table} SET label='runtime temporary' WHERE id=1`);
    assert.equal(updated.rowCount,1);
    const other=await admin.query(`UPDATE ${table} SET label='cross-tenant' WHERE id=2`);
    assert.equal(other.rowCount,0);
    await admin.query('ROLLBACK');tx=false;
    assert.deepEqual((await admin.query(rowSql)).rows,data);

    // A real COMMIT is intentional: ROLLBACK alone can no longer undo changes.
    await admin.query('BEGIN');tx=true;
    await admin.query(`ALTER TABLE ${table} OWNER TO vigia_ci`);
    await admin.query(`DROP POLICY ${policyReader} ON ${table}`);
    await admin.query(`DROP POLICY ${policyUpdate} ON ${table}`);
    await admin.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    await admin.query(`REVOKE SELECT(id,label) ON ${table} FROM ${reader}`);
    await admin.query(`REVOKE SELECT(id,label),UPDATE(label) ON ${table} FROM ${runtime}`);
    await admin.query(`DROP INDEX ${namespace}.${index}`);
    await admin.query(`ALTER TABLE ${table} ADD COLUMN committed_change text`);
    await admin.query(`UPDATE ${table} SET label='committed corruption' WHERE id=1`);
    await admin.query('COMMIT');tx=false;
    const changed=await snapshotDisposableCatalog(admin,namespace,roles);
    assert.notDeepEqual(changed,baseline,'test did not commit catalog changes');
    assert.notDeepEqual((await admin.query(rowSql)).rows,data,'test did not commit data change');

    // Explicit compensating migration, separate from original transaction.
    // This is a known synthetic plan, NOT a generic SQL restoration engine.
    await admin.query('BEGIN');tx=true;
    await admin.query(`ALTER TABLE ${table} DROP COLUMN committed_change`);
    await admin.query(`UPDATE ${table} SET label='original A' WHERE id=1`);
    await admin.query(`CREATE INDEX ${index} ON ${table}(tenant_id)`);
    await admin.query(`ALTER TABLE ${table} OWNER TO ${migrator}`);
    await admin.query(`GRANT SELECT(id,label) ON ${table} TO ${reader}`);
    await admin.query(`GRANT SELECT(id,label),UPDATE(label) ON ${table} TO ${runtime}`);
    await admin.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    await admin.query(readPolicy);
    await admin.query(updatePolicy);
    await admin.query('COMMIT');tx=false;

    assert.deepEqual(await snapshotDisposableCatalog(admin,namespace,roles),baseline,
      'post-commit compensation must restore owners, grants, RLS, indexes and constraints');
    assert.deepEqual((await admin.query(rowSql)).rows,data,'post-commit data must match baseline');
    console.log('ALT0810C7 PostgreSQL16: COMMIT + explicit compensating COMMIT restored catalog and data VERIFIED');
  }finally{
    if(tx)await admin.query('ROLLBACK').catch(()=>{});
    if(setupStarted){
      // No CASCADE. Cleanup never targets objects not created by this test.
      await admin.query(`DROP TABLE IF EXISTS ${table}`).catch(()=>{});
      await admin.query(`DROP SCHEMA IF EXISTS ${namespace}`).catch(()=>{});
      for(const role of [...roles].reverse())
        await admin.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
    }
    await admin.end();
  }
});
