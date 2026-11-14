import test from 'node:test';
import assert from 'node:assert/strict';
import {ALT0810C23,inspectNextPgBinding,assertNextPgOperationalReadiness,
 type NextPgBindingEvidence} from '../lib/tenant/alt0810c23-next-pg-runtime-gate';

const fields:NextPgBindingEvidence={
 actualNextRoute:true,signedCookieVerified:true,
 sessionVersionCheckedInTransaction:false,
 activeMembershipCheckedInTransaction:false,
 entitlementCheckedInTransaction:false,
 roleWithoutBypassRls:false,
 tenantScopeOnSameConnection:false,
 rlsSelectOnSameConnection:false,
 tenantContextRolledBack:false,
 nonSpoofableIdentityBinding:false,
 ephemeralPg16Only:true,
};
test('ALT-08.10C.23: Next.js PGlite route and separate PG16 fixture are not same-connection proof',()=>{
 const report=inspectNextPgBinding(fields);
 assert.equal(report.ready,false);
 assert.ok(report.missingEvidence.includes('tenantScopeOnSameConnection'));
 assert.ok(report.missingEvidence.includes('sessionVersionCheckedInTransaction'));
 assert.ok(report.missingEvidence.includes('entitlementCheckedInTransaction'));
 assert.equal(report.nextPgIntegrationCertified,false);
 assert.equal(report.migrationAuthorized,false);
 assert.equal(report.productionAuthorized,false);
 assert.equal(ALT0810C23.operationalAuthEnabled,false);
});
test('ALT-08.10C.23: spoofable app.user_id GUC prevents operational readiness',()=>{
 const report=inspectNextPgBinding({...fields,
  sessionVersionCheckedInTransaction:true,activeMembershipCheckedInTransaction:true,
  entitlementCheckedInTransaction:true,roleWithoutBypassRls:true,
  tenantScopeOnSameConnection:true,rlsSelectOnSameConnection:true,
  tenantContextRolledBack:true});
 assert.deepEqual(report.missingEvidence,['nonSpoofableIdentityBinding']);
 assert.throws(()=>assertNextPgOperationalReadiness({...fields,
  sessionVersionCheckedInTransaction:true,activeMembershipCheckedInTransaction:true,
  entitlementCheckedInTransaction:true,roleWithoutBypassRls:true,
  tenantScopeOnSameConnection:true,rlsSelectOnSameConnection:true,
  tenantContextRolledBack:true}),/NEXT_PG_BINDING_NOT_CERTIFIED:nonSpoofableIdentityBinding/);
});
test('ALT-08.10C.23: even all green fixture booleans cannot self-authorize migration',()=>{
 const complete=Object.fromEntries(
  Object.keys(fields).map(k=>[k,true])) as NextPgBindingEvidence;
 const report=inspectNextPgBinding(complete);
 assert.deepEqual(report.missingEvidence,[]);
 assert.equal(report.ready,false);
 assert.equal(report.migrationAuthorized,false);
 assert.throws(()=>assertNextPgOperationalReadiness(complete),/NEXT_PG_BINDING_NOT_CERTIFIED/);
});
