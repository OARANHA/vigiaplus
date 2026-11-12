import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {extractStaticBootstrapDdl} from '../lib/db/bootstrap-snapshot';
import {inspectBootstrapDependencies} from '../lib/db/bootstrap-dependencies';

test('ALT-08.10C.5: inventories frozen bootstrap offline and refuses migration readiness',()=>{
 const source=readFileSync(new URL('../lib/db/index.ts',import.meta.url),'utf8');
 const sql=extractStaticBootstrapDdl(source);
 const report=inspectBootstrapDependencies(sql);
 assert.equal(report.entries.length,186);
 assert.deepEqual(report.counts,{'create-table':62,'alter-table':78,'create-index':45,'data-update':1});
 assert.equal(report.readyForMigration,false);
 assert.equal(report.entries.filter(x=>x.hasDataMutation).length,1);
 for(const entry of report.entries){
  assert.equal(entry.sha256.length,64);
  assert.ok(entry.dependsOn.every(x=>report.entries.some(y=>y.ordinal<=entry.ordinal && y.kind==='create-table' && y.target===x)));
 }
});
test('ALT-08.10C.5: fails closed on unsupported or reordered SQL',()=>{
 const partial=inspectBootstrapDependencies([
  'CREATE TABLE IF NOT EXISTS collection_runs (project_id integer)',
  "CREATE UNIQUE INDEX IF NOT EXISTS collection_one_active_per_project ON collection_runs(project_id) WHERE status IN ('pending', 'running')",
  'CREATE INDEX IF NOT EXISTS collection_runs_gin ON collection_runs USING gin (project_id)'
 ]);
 assert.deepEqual(partial.counts,{'create-table':1,'alter-table':0,'create-index':2,'data-update':0});
 assert.throws(()=>inspectBootstrapDependencies(['DELETE FROM clients']),/UNCLASSIFIED/);
 assert.throws(()=>inspectBootstrapDependencies(['CREATE INDEX IF NOT EXISTS ix ON missing (id)']),/TABLE_NOT_YET_CREATED/);
 assert.throws(()=>inspectBootstrapDependencies(['CREATE TABLE IF NOT EXISTS child (id INT REFERENCES parent(id))']),/FORWARD_REFERENCE/);
 assert.throws(()=>inspectBootstrapDependencies(['CREATE TABLE IF NOT EXISTS a(id INT)','CREATE TABLE IF NOT EXISTS a(id INT)']),/DUPLICATE_TABLE/);
 assert.throws(()=>inspectBootstrapDependencies(['UPDATE missing SET foo=1']),/TABLE_NOT_YET_CREATED/);
});
