/**
 * ALT-08.10C.37: inspect pinned SQL locally only. Never connect to any DB.
 */
import {readFileSync} from 'node:fs';
import {ALT0810C37,validateC37ReadOnlyAudit} from
  '../lib/db/alt0810c37-audit-boundary';
if(process.env.DATABASE_URL||process.env.RLS_DATABASE_URL||
   process.env.NODE_ENV==='production')
  throw Error('ALT0810C37_OFFLINE_ONLY');
const sql=readFileSync(
  'schema/operational-rls/alt0810c37-authorized-readonly-audit.sql','utf8');
validateC37ReadOnlyAudit(sql);
console.log(JSON.stringify({
  gate:ALT0810C37.version,
  sqlSource:'repo-only',
  catalogOnly:true,
  sqlExecuted:false,
  neonTouched:false,
  realDatabaseAccessAuthorized:false,
  backupOfOperationalDataAuthorized:false,
  productionAuthorized:false,
  approval:'PENDING_EXPLICIT_HUMAN_AUTHORIZATION',
}));
