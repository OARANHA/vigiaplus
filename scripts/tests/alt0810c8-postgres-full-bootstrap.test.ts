/**
 * ALT-08.10C.8 — operational bootstrap compatibility in disposable PostgreSQL16.
 * Applies the 186 frozen legacy SQL statements inside a transaction isolated
 * by search_path, then ROLLBACK. Inert snapshot: NOT a migration runner.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractStaticBootstrapDdl,verifyBootstrapSnapshot,
 type BootstrapSnapshotManifest} from '../../lib/db/bootstrap-snapshot';
import {inspectBootstrapDependencies} from '../../lib/db/bootstrap-dependencies';
import {snapshotDisposableCatalog} from '../../lib/db/disposable-catalog-snapshot';
import {assessOperationalReadiness} from '../../lib/db/operational-readiness';
import {compareColumnContract} from '../../lib/db/operational-column-compatibility';
import {auditBootstrapStructure, type StructuralCatalogRow} from '../../lib/db/operational-structural-audit';
import {getTableColumns,getTableName,is} from 'drizzle-orm';
import {PgTable} from 'drizzle-orm/pg-core';
import * as drizzleSchema from '../../lib/db/schema';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.ALT0810C8_EPHEMERAL!=='1'||
   e.PGHOST!=='127.0.0.1'||e.PGPORT!=='5432'||
   e.PGDATABASE!=='vigia_alt081_ci'||e.PGUSER!=='vigia_ci'||
   e.PGPASSWORD!=='isolated_ci_only'||e.DATABASE_URL||
   e.RLS_DATABASE_URL||e.NODE_ENV==='production')
  throw Error('ALT0810C8_DISPOSABLE_POSTGRES_ONLY');

type Result={rows:Record<string,unknown>[];rowCount:number|null};
type Client={connect():Promise<void>;query(s:string,p?:unknown[]):Promise<Result>;end():Promise<void>};
const {Client:PgClient}=createRequire(import.meta.url)('pg') as
 {Client:new(options:Record<string,unknown>)=>Client};
const client=new PgClient({host:'127.0.0.1',port:5432,
 database:'vigia_alt081_ci',user:'vigia_ci',password:'isolated_ci_only'});
const ns='alt0810c6_fullschema';
const role='alt0810c6_fullschema_reader';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const source=readFileSync(resolve(root,'lib/db/index.ts'),'utf8');
const snapshot=readFileSync(resolve(root,'schema/operational-bootstrap/00001_legacy_snapshot.sql'),'utf8');
const manifest=JSON.parse(readFileSync(resolve(root,'schema/operational-bootstrap/manifest.json'),'utf8')) as BootstrapSnapshotManifest;
const count=verifyBootstrapSnapshot(source,snapshot,manifest);
const statements=extractStaticBootstrapDdl(source);
const inventory=inspectBootstrapDependencies(statements);

test('ALT-08.10C.8: full SQL snapshot in PG16 transaction preserves previous state',async()=>{
  assert.equal(count,186);
  assert.equal(inventory.entries.length,186);
  assert.equal(inventory.readyForMigration,false);
  await client.connect();
  let initialized=false,tx=false;
  try{
    const existingSchema=await client.query('SELECT to_regnamespace($1) AS namespace',[ns]);
    assert.equal(existingSchema.rows[0]?.namespace,null,'refuse existing schema');
    const existingRole=await client.query('SELECT rolname FROM pg_roles WHERE rolname=$1',[role]);
    assert.equal(existingRole.rows.length,0,'refuse existing role');
    initialized=true;
    await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE`);
    await client.query(`CREATE SCHEMA ${ns}`);
    await client.query(`CREATE TABLE ${ns}.preexisting (
      id integer PRIMARY KEY, tenant_id integer NOT NULL, secret text NOT NULL)`);
    await client.query(`INSERT INTO ${ns}.preexisting VALUES (1,10,'untouched')`);
    await client.query(`GRANT USAGE ON SCHEMA ${ns} TO ${role}`);
    await client.query(`GRANT SELECT(id,tenant_id) ON ${ns}.preexisting TO ${role}`);
    await client.query(`ALTER TABLE ${ns}.preexisting ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE ${ns}.preexisting FORCE ROW LEVEL SECURITY`);
    await client.query(`CREATE POLICY alt0810c8_read ON ${ns}.preexisting
      FOR SELECT TO ${role} USING (tenant_id=10)`);
    const before=await snapshotDisposableCatalog(client,ns,[role]);
    const beforeData=(await client.query(`SELECT * FROM ${ns}.preexisting ORDER BY id`)).rows;
    assert.equal(before.policies.length,1);
    assert.ok(before.columnGrants.some(x=>x.includes(role)));

    await client.query('BEGIN');tx=true;
    await client.query(`SET LOCAL search_path TO ${ns}`);
    for(let i=0;i<statements.length;i++){
      try{await client.query(statements[i]);}
      catch(err){throw Error(`ALT0810C8_STATEMENT_${i+1}_FAILED: ${String(err)}`)}
    }
    const op=await client.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=$1`,[ns]);
    assert.equal(Number(op.rows[0].n),63,'62 new tables plus sentinel expected');
    for(const name of ['users','memberships','tenants','subscriptions','plans','plan_features','tenant_features']){
      const exists=await client.query('SELECT to_regclass($1) AS id',[`${ns}.${name}`]);
      assert.ok(exists.rows[0].id,`operational schema missing ${name}`);
    }
    // Catalog creation is not readiness: no RLS/tenant entitlement policy
    // provisioning is implied by the frozen legacy DDL snapshot.
    const missing=await client.query(`SELECT count(*)::int AS n FROM pg_tables t
      JOIN pg_class c ON c.oid=(quote_ident(t.schemaname)||'.'||quote_ident(t.tablename))::regclass
      WHERE t.schemaname=$1 AND t.tablename <> 'preexisting' AND c.relrowsecurity=false`,[ns]);
    assert.ok(Number(missing.rows[0].n)>0,'legacy snapshot unexpectedly had full RLS');
    const readiness=assessOperationalReadiness(await snapshotDisposableCatalog(client,ns,[role]));
    assert.deepEqual(readiness.missingTables,[]);
    assert.equal(readiness.unprotectedTables.length,7);
    assert.equal(readiness.missingMigrationLedger,true);
    assert.equal(readiness.missingTenantIsolationEvidence,true);
    assert.equal(readiness.readyForOperationalAuth,false);
    assert.equal(readiness.migrationAllowed,false);
    assert.equal(readiness.productionAllowed,false);
    const pgRows=await client.query(`SELECT c.relname AS table,a.attname AS column,
      format_type(a.atttypid,a.atttypmod) AS sql_type,a.attnotnull AS not_null
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$1 AND c.relkind IN ('r','p')
        AND c.relname <> 'preexisting' AND a.attnum>0 AND NOT a.attisdropped
      ORDER BY c.relname,a.attnum`,[ns]);
    const ormColumns=Object.values(drizzleSchema).filter(v=>is(v,PgTable))
      .flatMap(t=>Object.values(getTableColumns(t as PgTable)).map(col=>({
        table:getTableName(t as PgTable),column:col.name,
        sqlType:col.getSQLType(),notNull:col.notNull
      })));
    const pgColumns=pgRows.rows.map(r=>({
      table:String(r.table),column:String(r.column),
      sqlType:String(r.sql_type),notNull:r.not_null===true
    }));
    const compatibility=compareColumnContract(ormColumns,pgColumns);
    assert.ok(compatibility.counts.expectedColumns>0);
    assert.ok(compatibility.counts.actualColumns>0);
    assert.equal(compatibility.schemaCertified,false);
    assert.equal(compatibility.migrationAuthorized,false);
    assert.equal(compatibility.productionAuthorized,false);
    console.log('ALT0810C15 DISPOSABLE PG16 ORM COLUMN AUDIT '+JSON.stringify({
      ...compatibility.counts,sha256:compatibility.evidenceSha256,
      sampleGaps:compatibility.gaps.slice(0,15),migrationAuthorized:false
    }));
    const structureCatalog=await client.query(`SELECT c.relname AS table,idx.relname AS name,
     'index' AS kind,pg_get_indexdef(idx.oid) AS detail,NULL::text AS constraint_type
     FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid
     JOIN pg_class idx ON idx.oid=i.indexrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relname<>'preexisting'
     UNION ALL
     SELECT c.relname AS table,co.conname AS name,
     'constraint' AS kind,pg_get_constraintdef(co.oid) AS detail,
     co.contype::text AS constraint_type
     FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relname<>'preexisting'
     UNION ALL
     SELECT c.relname AS table,a.attname AS name,
     'default' AS kind,pg_get_expr(d.adbin,d.adrelid) AS detail,
     NULL::text AS constraint_type
     FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
     JOIN pg_class c ON c.oid=d.adrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relname<>'preexisting'`,[ns]);
    const structural=auditBootstrapStructure(statements,structureCatalog.rows.map(r=>({
      table:String(r.table),name:String(r.name),
      kind:String(r.kind) as StructuralCatalogRow['kind'],
      detail:String(r.detail),constraintType:r.constraint_type===null?undefined:String(r.constraint_type)
    })));
    assert.equal(structural.expectedNamedIndexes,45);
    assert.deepEqual(structural.missingNamedIndexes,[],
      'a named bootstrap index is absent from PostgreSQL catalog');
    assert.equal(structural.missingForeignKeys,0,
      'one or more declared REFERENCES have no corresponding FK constraint');
    assert.equal(structural.schemaCertified,false);
    assert.equal(structural.migrationAuthorized,false);
    console.log('ALT0810C16 PG16 STRUCTURAL REPORT '+JSON.stringify(structural));
    await client.query('ROLLBACK');tx=false;
    assert.deepEqual(await snapshotDisposableCatalog(client,ns,[role]),before,
      'catalog ACL/RLS/indexes/constraints/roles changed after rollback');
    assert.deepEqual((await client.query(`SELECT * FROM ${ns}.preexisting ORDER BY id`)).rows,beforeData);
    assert.equal((await client.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname=$1`,[ns])).rows[0].n,1);
    console.log('ALT0810C8: 186 legacy statements on PostgreSQL16, 62 operational tables, ROLLBACK to preexisting ACL/RLS/data; operational readiness NO-GO');
  }finally{
    if(tx)await client.query('ROLLBACK').catch(()=>{});
    if(initialized){
      await client.query(`DROP TABLE IF EXISTS ${ns}.preexisting`).catch(()=>{});
      await client.query(`DROP SCHEMA IF EXISTS ${ns}`).catch(()=>{});
      await client.query(`DROP ROLE IF EXISTS ${role}`).catch(()=>{});
    }
    await client.end();
  }
});
