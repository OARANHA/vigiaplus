/**
 * ALT-08.10C.23 — safety gate for bridging actual Next.js request
 * authentication with an interactive PostgreSQL transaction.
 *
 * A PGlite route test plus a separate PostgreSQL HTTP fixture is NOT proof
 * that Next.js uses the same PG16 connection. This contract forbids that
 * false-positive and keeps operational migration strictly disabled.
 */
export const ALT0810C23={
 version:'alt0810c23-next-pg-transaction-readiness-v1',
 status:'integration-blocked',
 operationalAuthEnabled:false,
 migrationAuthorized:false,
 stagingAuthorized:false,
 productionAuthorized:false,
} as const;

export type NextPgBindingEvidence={
 actualNextRoute:boolean;
 signedCookieVerified:boolean;
 sessionVersionCheckedInTransaction:boolean;
 activeMembershipCheckedInTransaction:boolean;
 entitlementCheckedInTransaction:boolean;
 roleWithoutBypassRls:boolean;
 tenantScopeOnSameConnection:boolean;
 rlsSelectOnSameConnection:boolean;
 tenantContextRolledBack:boolean;
 nonSpoofableIdentityBinding:boolean;
 ephemeralPg16Only:boolean;
};
export type NextPgBindingReport={
 ready:false;
 missingEvidence:(keyof NextPgBindingEvidence)[];
 nextPgIntegrationCertified:false;
 migrationAuthorized:false;
 productionAuthorized:false;
};

export function inspectNextPgBinding(
 evidence:Readonly<NextPgBindingEvidence>,
):NextPgBindingReport{
 const fields:(keyof NextPgBindingEvidence)[]=[
  'actualNextRoute','signedCookieVerified','sessionVersionCheckedInTransaction',
  'activeMembershipCheckedInTransaction','entitlementCheckedInTransaction',
  'roleWithoutBypassRls','tenantScopeOnSameConnection',
  'rlsSelectOnSameConnection','tenantContextRolledBack',
  'nonSpoofableIdentityBinding','ephemeralPg16Only',
 ];
 const missingEvidence=fields.filter(key=>evidence[key]!==true);
 return {
  ready:false,missingEvidence,
  nextPgIntegrationCertified:false,migrationAuthorized:false,
  productionAuthorized:false,
 };
}

/**
 * All current application database adapters lack verified interactive
 * PostgreSQL16 transaction integration for Next route session+RLS:
 * - Neon HTTP adapter is not an interactive connection/session.
 * - PGlite is isolated, but not the same PostgreSQL16 service.
 * Enforce NO-GO even if a future fixture claims all booleans true: only a
 * reviewed, operationally approved adapter can lift this gate.
 */
export function assertNextPgOperationalReadiness(
 evidence:Readonly<NextPgBindingEvidence>,
):never{
 const report=inspectNextPgBinding(evidence);
 throw Error('ALT0810C23_NEXT_PG_BINDING_NOT_CERTIFIED:'+report.missingEvidence.join(','));
}
