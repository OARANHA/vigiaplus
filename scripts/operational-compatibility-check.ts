/** ALT-08.10C.14: no database, migrations or application import. */
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {extractStaticBootstrapDdl,verifyBootstrapSnapshot,
 type BootstrapSnapshotManifest} from '../lib/db/bootstrap-snapshot';
import {inspectBootstrapDependencies} from '../lib/db/bootstrap-dependencies';
import {buildOperationalCompatibilityReport} from '../lib/db/operational-compatibility-audit';
if(process.env.DATABASE_URL||process.env.RLS_DATABASE_URL||process.env.NODE_ENV==='production')
 throw Error('ALT0810C14_OFFLINE_ONLY');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=(path:string)=>readFileSync(resolve(root,path),'utf8');
const source=read('lib/db/index.ts');
const frozen=read('schema/operational-bootstrap/00001_legacy_snapshot.sql');
const manifest=JSON.parse(read('schema/operational-bootstrap/manifest.json')) as BootstrapSnapshotManifest;
verifyBootstrapSnapshot(source,frozen,manifest);
const inventory=inspectBootstrapDependencies(extractStaticBootstrapDdl(source));
const report=buildOperationalCompatibilityReport(read('lib/db/schema.ts'),inventory,
 read('migrations/00002_rls.sql'));
if(report.readyForMigration||report.readyForOperationalAuth||report.productionAuthorized)
 throw Error('ALT0810C14_UNAUTHORIZED_READINESS');
console.log(JSON.stringify(report,null,2));
console.log('ALT0810C14 OFFLINE ORM/BOOTSTRAP/RLS AUDIT — MIGRATION NO-GO');
