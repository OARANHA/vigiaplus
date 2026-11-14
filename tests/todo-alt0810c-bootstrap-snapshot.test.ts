import test from 'node:test';
import assert from 'node:assert/strict';
import {extractStaticBootstrapDdl,renderBootstrapSnapshot,
 verifyBootstrapSnapshot,type BootstrapSnapshotManifest} from '../lib/db/bootstrap-snapshot';
import {gitBlobSha1} from '../lib/db/migration-manifest';

const source="const DDL = [\x60CREATE TABLE demo(id integer)\x60,\x60ALTER TABLE demo ADD COLUMN foo text\x60];";
const statements=['CREATE TABLE demo(id integer)','ALTER TABLE demo ADD COLUMN foo text'];
const snapshot=renderBootstrapSnapshot(statements);
const manifest:BootstrapSnapshotManifest={
 version:1,status:'snapshot-only-no-migration-authorization',
 source:'lib/db/index.ts',sourceConstant:'DDL',
 statementCount:2,
 output:'schema/operational-bootstrap/00001_legacy_snapshot.sql',
 outputGitBlobSha1:gitBlobSha1(snapshot),
 includesDataUpdate:false,bootstrapSeparated:false,
 operationalSchemaCertified:false,migrationRunnerActivated:false
};
test('ALT-08.10C.3: preserves original static bootstrap statement order',()=>{
 assert.deepEqual(extractStaticBootstrapDdl(source),statements);
 assert.equal(verifyBootstrapSnapshot(source,snapshot,manifest),2);
});
test('ALT-08.10C.3: refuses altered source, arbitrary snapshot and false operational certification',()=>{
 assert.throws(()=>verifyBootstrapSnapshot(source,snapshot+'\n',manifest),/DRIFT/);
 assert.throws(()=>verifyBootstrapSnapshot(source.replace('foo text','bar text'),snapshot,manifest),/DRIFT/);
 assert.throws(()=>verifyBootstrapSnapshot(source,snapshot,{...manifest,bootstrapSeparated:true}),/DRIFT/);
 assert.throws(()=>verifyBootstrapSnapshot(source,snapshot,{...manifest,migrationRunnerActivated:true}),/DRIFT/);
 assert.throws(()=>verifyBootstrapSnapshot(source,snapshot,{...manifest,operationalSchemaCertified:true}),/DRIFT/);
});
test('ALT-08.10C.3: refuses dynamic SQL, semicolons and ambiguous DDL declarations',()=>{
 assert.throws(()=>extractStaticBootstrapDdl('const DDL=[\x60SELECT ${1}\x60]'),/DYNAMIC/);
 assert.throws(()=>extractStaticBootstrapDdl('const DDL=[\x60DROP TABLE t; SELECT 1\x60]'),/DYNAMIC/);
 assert.throws(()=>extractStaticBootstrapDdl(source+'\nconst DDL=[];'),/AMBIGUOUS/);
 assert.throws(()=>extractStaticBootstrapDdl('const DDL=[]'),/EMPTY/);
});
