/**
 * ALT-08.10C.6: scoped catalog/ACL/RLS/ownership rollback rehearsal.
 * GitHub Actions PostgreSQL 16 service only; NEVER connect to Neon/staging.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {snapshotDisposableCatalog,type CatalogQuery} from '../../lib/db/disposable-catalog-snapshot';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.ALT0810C6_EPHEMERAL!=='1'||
  e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||
  e.PGDATABASE!=='vigia_alt081_ci'||e.PGUSER!=='vigia_ci'||
  e.PGPASSWORD!=='isolated_ci_only'||e.DATABASE_URL||e.RLS_DATABASE_URL||
  e.NODE_ENV==='production')
  throw Error('ALT0810C6_DISPOSABLE_POSTGRES_ONLY');

const {Client}=createRequire(import.meta.url)('pg') as {
  Client:new(options:Record<string,unknown>)=>CatalogQuery&{connect():Promise<void>;end():Promise<void>}
};
const admin=new Client({host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
  user:'vigia_ci',password:'isolated_ci_only'});
const schema='alt0810c6_ci';
const reader='alt0810c6_reader';
const owner='alt0810c6_owner';
const roles=[reader,owner];
const scoped=schema+'.evidence';

test('ALT-08.10C.6: rollback restores pre-existing catalog exactly after failed DDL',async()=>{
 await admin.connect();
 let began=false;
 try{
  // Strictly disposable namespace and roles. Preflight refuses collisions.
  const exists=await admin.query(`SELECT to_regnamespace($1) AS ns`,[schema]);
  assert.equal(exists.rows[0]?.ns,null,'test namespace already exists');
  const prior=await admin.query(`SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])`,[roles]);
  assert.equal(prior.rows.length,0,'test roles already exist');

  await admin.query(`CREATE ROLE ${reader} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE`);
  await admin.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE`);
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`CREATE TABLE ${scoped} (
    id integer PRIMARY KEY,tenant_id integer NOT NULL,
    label text NOT NULL, private_note text NOT NULL,
    CONSTRAINT alt0810c6_positive CHECK (tenant_id>0))`);
  await admin.query(`INSERT INTO ${scoped} VALUES(1,771,'preserve','private')`);
  await admin.query(`CREATE INDEX alt0810c6_tenant_idx ON ${scoped}(tenant_id)`);
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${reader}`);
  await admin.query(`GRANT SELECT(id,tenant_id,label) ON ${scoped} TO ${reader}`);
  await admin.query(`ALTER TABLE ${scoped} ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE ${scoped} FORCE ROW LEVEL SECURITY`);
  await admin.query(`CREATE POLICY alt0810c6_policy ON ${scoped}
    FOR SELECT TO ${reader} USING (tenant_id=771)`);
  // ALTER OWNER is legal in disposable CI (admin is superuser within container).
  await admin.query(`ALTER TABLE ${scoped} OWNER TO ${owner}`);
  const before=await snapshotDisposableCatalog(admin,schema,roles);
  assert.equal(before.namespaces.length,1);
  assert.ok(before.relations.some(x=>x.includes('alt0810c6_owner')));
  assert.ok(before.policies.some(x=>x.includes('alt0810c6_policy')));
  assert.ok(before.indexes.some(x=>x.includes('alt0810c6_tenant_idx')));
  assert.ok(before.constraints.some(x=>x.includes('alt0810c6_positive')));
  assert.ok(before.columnGrants.some(x=>x.includes('alt0810c6_reader')));
  assert.equal(before.roles.length,2);
  const originalRows=(await admin.query(`SELECT id,tenant_id,label,private_note FROM ${scoped} ORDER BY id`)).rows;

  await admin.query('BEGIN');began=true;
  await admin.query(`ALTER TABLE ${scoped} OWNER TO vigia_ci`);
  await admin.query(`DROP POLICY alt0810c6_policy ON ${scoped}`);
  await admin.query(`ALTER TABLE ${scoped} DISABLE ROW LEVEL SECURITY`);
  await admin.query(`REVOKE SELECT(id,tenant_id,label) ON ${scoped} FROM ${reader}`);
  await admin.query(`REVOKE USAGE ON SCHEMA ${schema} FROM ${reader}`);
  await admin.query(`DROP INDEX ${schema}.alt0810c6_tenant_idx`);
  await admin.query(`ALTER TABLE ${scoped} ADD COLUMN unsafe_new text`);
  await admin.query(`UPDATE ${scoped} SET label='corrupted'`);
  await admin.query(`CREATE TABLE ${schema}.unsafe_new_table (id integer)`);
  await assert.rejects(admin.query('SELECT 1/0 AS forced_failure'));
  await admin.query('ROLLBACK');began=false;
  const after=await snapshotDisposableCatalog(admin,schema,roles);
  assert.deepEqual(after,before,'ACL, column grants, policies, owners, constraints, indexes and roles must be identical');
  assert.deepEqual((await admin.query(`SELECT id,tenant_id,label,private_note FROM ${scoped} ORDER BY id`)).rows,originalRows);

  // Also demonstrate successful transaction is explicitly undone.
  await admin.query('BEGIN');began=true;
  await admin.query(`ALTER TABLE ${scoped} ADD COLUMN transient integer`);
  await admin.query('ROLLBACK');began=false;
  assert.deepEqual(await snapshotDisposableCatalog(admin,schema,roles),before);
  console.log('ALT0810C6 PostgreSQL16: scoped ACL/policies/owners/indexes/constraints/roles/data rollback VERIFIED');
 } finally{
  if(began)await admin.query('ROLLBACK').catch(()=>{});
  // No CASCADE: cleanup must fail if unexpected dependent objects appeared.
  await admin.query(`DROP TABLE IF EXISTS ${scoped}`).catch(()=>{});
  await admin.query(`DROP SCHEMA IF EXISTS ${schema}`).catch(()=>{});
  await admin.query(`DROP ROLE IF EXISTS ${reader}`).catch(()=>{});
  await admin.query(`DROP ROLE IF EXISTS ${owner}`).catch(()=>{});
  await admin.end();
 }
});
