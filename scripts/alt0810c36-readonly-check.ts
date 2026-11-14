/**
 * ALT-08.10C.36 — offline-only contract gate. No database or environment
 * credentials are read, no network, no migration runner or RLS DDL.
 */
import {readFileSync} from 'node:fs';
import {validateC36Plan} from '../lib/db/alt0810c36-preoperational-audit';
const p=validateC36Plan(JSON.parse(readFileSync(
  'schema/operational-rls/alt0810c36-prestaging-plan.json','utf8',
)) as unknown);
console.log(JSON.stringify({
  gate:p.id,postgresMajor:p.postgresMajor,
  catalogOnly:p.readOnlyCatalogOnly,
  tableMatrix:[p.scope.evidence,...p.dependencies],
  expectedEvidence:p.requiredGateEvidence,
  stagingAuthorized:p.stagingApproved,
  neonAuthorized:p.neonApproved,
  productionAuthorized:p.productionApproved,
  physicalBackupCertified:p.physicalBackupRestoreCertified,
  outcome:'FIXTURE_PRESTAGING_PLAN_ONLY_NO_GO',
}));
