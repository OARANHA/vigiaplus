import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractStaticBootstrapDdl,verifyBootstrapSnapshot,
 type BootstrapSnapshotManifest} from '../lib/db/bootstrap-snapshot';
import {inspectBootstrapDependencies} from '../lib/db/bootstrap-dependencies';
import {extractDrizzleTablesAst,buildOperationalCompatibilityReport}
 from '../lib/db/operational-compatibility-audit';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(path:string)=>readFileSync(resolve(root,path),'utf8');
const src=read('lib/db/index.ts');
const snapshot=read('schema/operational-bootstrap/00001_legacy_snapshot.sql');
const manifest=JSON.parse(read('schema/operational-bootstrap/manifest.json')) as BootstrapSnapshotManifest;
verifyBootstrapSnapshot(src,snapshot,manifest);
const ddl=extractStaticBootstrapDdl(src);
const inventory=inspectBootstrapDependencies(ddl);
const schema=read('lib/db/schema.ts');
const rls=read('migrations/00002_rls.sql');

test('ALT-08.10C.14: static drift report is deterministic and never authorizes migrations',()=>{
 const report=buildOperationalCompatibilityReport(schema,inventory,rls);
 assert.deepEqual(report,buildOperationalCompatibilityReport(schema,inventory,rls));
 assert.equal(report.bootstrapStatements,186);
 assert.equal(report.bootstrapTables.length,62);
 assert.equal(report.drizzleTables.length>0,true);
 assert.match(report.analysisSha256,/^[0-9a-f]{64}$/);
 assert.equal(report.readyForMigration,false);
 assert.equal(report.readyForOperationalAuth,false);
 assert.equal(report.productionAuthorized,false);
 assert.ok(report.migrationRlsTables.length>0);
 assert.ok(report.permissiveMissingContextPolicies.length>0,
  'legacy RLS has NULL-context bypass requiring review');
 assert.ok(report.unprotectedByLegacyRls.length>0,
  'not all Drizzle tables have policies defined by legacy migration');
});

test('ALT-08.10C.14: AST handles pgTable and rejects dynamic or duplicate definitions',()=>{
 assert.deepEqual(extractDrizzleTablesAst(
  "export const users=pgTable('users',{});export const tenants=pgTable('tenants',{});"),
  ['tenants','users']);
 assert.throws(()=>extractDrizzleTablesAst("export const t=pgTable(name,{})"),/NON_LITERAL/);
 assert.throws(()=>extractDrizzleTablesAst(
  "const a=pgTable('dup',{});const b=pgTable('dup',{})"),/DUPLICATE/);
 assert.throws(()=>extractDrizzleTablesAst('export const a=1'),/MISSING/);
});

test('ALT-08.10C.14: synthetic missing-table, new policy and permissive NULL context are flagged',()=>{
 const mini=inspectBootstrapDependencies(['CREATE TABLE IF NOT EXISTS users (id int)']);
 const r=buildOperationalCompatibilityReport(
  "const a=pgTable('users',{});const b=pgTable('new_tenant_data',{});",
  mini,
  `ALTER TABLE users ENABLE ROW LEVEL SECURITY;
    CREATE POLICY p ON users USING (current_setting('app.tenant_id', true) IS NULL OR id=1);`
 );
 assert.deepEqual(r.onlyDrizzle,['new_tenant_data']);
 assert.deepEqual(r.onlyBootstrap,[]);
 assert.deepEqual(r.unprotectedByLegacyRls,['new_tenant_data']);
 assert.deepEqual(r.permissiveMissingContextPolicies,['tenant_context_optional']);
 assert.equal(r.readyForMigration,false);
});
