/**
 * ALT-08.10C.11 — offline CI report. Only local file reads and stdout.
 * Does not connect, apply DDL, invoke migrate.ts or initialize getDb().
 */
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractStaticBootstrapDdl,verifyBootstrapSnapshot,
 type BootstrapSnapshotManifest} from '../lib/db/bootstrap-snapshot';
import {inspectBootstrapDependencies} from '../lib/db/bootstrap-dependencies';
import {buildOperationalMigrationEvidence,ALT0810C11_POLICY}
 from '../lib/db/operational-migration-evidence';

if(process.env.DATABASE_URL||process.env.RLS_DATABASE_URL||
   process.env.NODE_ENV==='production')
 throw Error('ALT0810C11_OFFLINE_ONLY');

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(name:string)=>readFileSync(resolve(root,name),'utf8');
const source=read('lib/db/index.ts');
const snapshot=read('schema/operational-bootstrap/00001_legacy_snapshot.sql');
const manifest=JSON.parse(read('schema/operational-bootstrap/manifest.json')) as BootstrapSnapshotManifest;
verifyBootstrapSnapshot(source,snapshot,manifest);
const statements=extractStaticBootstrapDdl(source);
const inventory=inspectBootstrapDependencies(statements);
const plan=buildOperationalMigrationEvidence(statements,inventory);
if(plan.migrationAuthorized||plan.stagingAuthorized||plan.productionAuthorized||
   !plan.requiresLogicalBackup||!plan.requiresPhysicalBackup||
   ALT0810C11_POLICY.migrationRunnerActivated)
 throw Error('ALT0810C11_UNSAFE_APPROVAL_STATE');
console.log(JSON.stringify({
 version:plan.version,statementCount:plan.statementCount,
 sourceSha256:plan.sourceSha256,planSha256:plan.planSha256,
 counts:inventory.counts,
 stepsWithDataBackup:plan.steps.filter(x=>x.requiresDataBackup).length,
 prerequisites:ALT0810C11_POLICY.prerequisites,
 blockingReasons:plan.blockingReasons,
 migrationAuthorized:plan.migrationAuthorized,
 stagingAuthorized:plan.stagingAuthorized,
 productionAuthorized:plan.productionAuthorized,
 rollbackExecutable:plan.rollbackExecutable,
},null,2));
console.log('ALT0810C11 OFFLINE EVIDENCE VERIFIED: NO DATABASE, NO MIGRATION, NO DEPLOY');
