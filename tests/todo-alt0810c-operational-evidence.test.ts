import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractStaticBootstrapDdl,verifyBootstrapSnapshot,
 type BootstrapSnapshotManifest} from '../lib/db/bootstrap-snapshot';
import {inspectBootstrapDependencies} from '../lib/db/bootstrap-dependencies';
import {ALT0810C11_POLICY,buildOperationalMigrationEvidence,assertNotExecutable}
 from '../lib/db/operational-migration-evidence';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=readFileSync(resolve(root,'lib/db/index.ts'),'utf8');
const snapshot=readFileSync(resolve(root,'schema/operational-bootstrap/00001_legacy_snapshot.sql'),'utf8');
const manifest=JSON.parse(readFileSync(resolve(root,'schema/operational-bootstrap/manifest.json'),'utf8')) as BootstrapSnapshotManifest;
verifyBootstrapSnapshot(source,snapshot,manifest);
const statements=extractStaticBootstrapDdl(source);
const inventory=inspectBootstrapDependencies(statements);

test('ALT-08.10C.11: 186 steps immutable, deterministic and never authorized',()=>{
 const a=buildOperationalMigrationEvidence(statements,inventory);
 const b=buildOperationalMigrationEvidence(statements,inventory);
 assert.deepEqual(a,b);
 assert.equal(a.statementCount,186);
 assert.equal(a.steps.length,186);
 assert.match(a.sourceSha256,/^[0-9a-f]{64}$/);
 assert.match(a.planSha256,/^[0-9a-f]{64}$/);
 assert.equal(a.steps.filter(x=>x.kind==='data-update').length,1);
 assert.equal(a.steps.filter(x=>x.kind==='create-table').length,62);
 assert.equal(a.steps.filter(x=>x.kind==='alter-table').length,78);
 assert.equal(a.steps.filter(x=>x.kind==='create-index').length,45);
 assert.ok(a.steps.every(x=>x.reversibleAutomatically===false));
 assert.ok(a.steps.every(x=>x.prerequisites.every(dep=>dep<x.ordinal)));
 assert.ok(a.steps.some(x=>x.requiresDataBackup));
 assert.equal(a.requiresPhysicalBackup,true);
 assert.equal(a.requiresLogicalBackup,true);
 assert.equal(a.rollbackExecutable,false);
 assert.equal(a.migrationAuthorized,false);
 assert.equal(a.stagingAuthorized,false);
 assert.equal(a.productionAuthorized,false);
 assert.equal(ALT0810C11_POLICY.migrationRunnerActivated,false);
 assert.throws(()=>assertNotExecutable(a),/EVIDENCE_ONLY_NOT_EXECUTABLE/);
});
test('ALT-08.10C.11: refuses drift, duplicate, missing SQL and fake readiness',()=>{
 assert.throws(()=>buildOperationalMigrationEvidence(statements.slice(1),inventory),/INVALID_LEGACY_SNAPSHOT/);
 assert.throws(()=>buildOperationalMigrationEvidence(statements,{...inventory,readyForMigration:true} as never),
  /INVALID_LEGACY_SNAPSHOT/);
 const drift=[...statements];drift[22]+=' ';
 // SQL whitespace is not part of semantic hash; changing the operation is.
 drift[22]+=' /* tampered */';
 assert.throws(()=>buildOperationalMigrationEvidence(drift,inventory),/STATEMENT_DRIFT/);
 const corrupt={...inventory,entries:inventory.entries.map((x,i)=>i===5?{...x,ordinal:100}:x)};
 assert.throws(()=>buildOperationalMigrationEvidence(statements,corrupt),/STATEMENT_DRIFT/);
});
