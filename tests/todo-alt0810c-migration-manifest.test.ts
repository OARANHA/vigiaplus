import test from 'node:test';
import assert from 'node:assert/strict';
import {gitBlobSha1,verifyLegacyMigrationManifest} from '../lib/db/migration-manifest';

const file='00001_example.sql';
const raw=Buffer.from('SELECT 1;\n','utf8');
const good={
 schemaVersion:1,purpose:'legacy-sql-migration-inventory-only',
 authoritativeOperationalSchema:false,bootstrapSeparated:false,
 migrations:[{file,gitBlobSha1:gitBlobSha1(raw)}],
};
test('ALT-08.10C: SHA1 Git blob is content-addressed and SHA256 ledger computed offline',()=>{
 const proof=verifyLegacyMigrationManifest(good,{[file]:raw});
 assert.equal(proof.files,1);
 assert.match(proof.sha256[file],/^[0-9a-f]{64}$/);
 assert.notEqual(gitBlobSha1(Buffer.from('SELECT 2;\n')),gitBlobSha1(raw));
});
test('ALT-08.10C: refuses incomplete, altered, duplicate and unversioned manifest',()=>{
 assert.throws(()=>verifyLegacyMigrationManifest(good,{[file]:Buffer.from('SELECT 2;\n')}),/CHECKSUM_MISMATCH/);
 assert.throws(()=>verifyLegacyMigrationManifest(good,{[file]:raw,'00002_missing.sql':'select 2'}),/FILE_SET_MISMATCH/);
 assert.throws(()=>verifyLegacyMigrationManifest({...good,bootstrapSeparated:true},{[file]:raw}),/UNSAFE_CONTRACT/);
 assert.throws(()=>verifyLegacyMigrationManifest({...good,authoritativeOperationalSchema:true},{[file]:raw}),/UNSAFE_CONTRACT/);
 assert.throws(()=>verifyLegacyMigrationManifest({...good,schemaVersion:2},{[file]:raw}),/UNSAFE_CONTRACT/);
 assert.throws(()=>verifyLegacyMigrationManifest({...good,migrations:[good.migrations[0],good.migrations[0]]},{[file]:raw}),/FILE_SET_MISMATCH/);
 assert.throws(()=>verifyLegacyMigrationManifest({...good,migrations:[{...good.migrations[0],file:'../evil.sql'}]},{[file]:raw}),/ENTRY_INVALID|FILE_SET_MISMATCH/);
});
