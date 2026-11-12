/**
 * ALT-08.10C.3: Offline reproducibility gate for frozen legacy bootstrap.
 * No app imports, no DB initialization, no network, no DDL execution.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';
import {verifyBootstrapSnapshot,type BootstrapSnapshotManifest} from '../lib/db/bootstrap-snapshot';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifestPath=resolve(root,'schema/operational-bootstrap/manifest.json');
const sourcePath=resolve(root,'lib/db/index.ts');
const snapshotPath=resolve(root,'schema/operational-bootstrap/00001_legacy_snapshot.sql');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as BootstrapSnapshotManifest;
const n=verifyBootstrapSnapshot(readFileSync(sourcePath,'utf8'),
 readFileSync(snapshotPath,'utf8'),manifest);
console.log(`ALT0810C BOOTSTRAP SNAPSHOT VERIFIED: ${n} ordered statements, Git blob content hash matched`);
console.log('ALT0810C BOOTSTRAP ISOLATED: NO DB CONNECTION, NO SQL EXECUTION, PRODUCTION NO-GO');
