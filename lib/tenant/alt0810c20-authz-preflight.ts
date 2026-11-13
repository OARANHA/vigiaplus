/**
 * ALT-08.10C.20 — isolated, explicit authorization gate.
 * Input identity MUST originate from authenticated server session, never HTTP
 * headers or body. Pure decision only: no runtime wiring or migration.
 */
export const ALT0810C20={
 version:'alt0810c20-authz-preflight-v1',
 status:'offline-and-disposable-ci-only',
 operationalAuthEnabled:false,
 stagingAuthorized:false,
 productionAuthorized:false,
} as const;
export type AuthenticatedPrincipal={
 userId:number;sessionVersion:number;verifiedSessionVersion:number;
 globalRole:'client'|'owner'|'analyst';
};
export type TenantMembership={
 userId:number;tenantId:number;role:'client_viewer'|'client_admin';active:boolean;
};
export type TenantContract={
 tenantId:number;status:'active'|'pending'|'suspended';
 subscriptionStatus:'active'|'past_due'|'suspended'|'none';
 entitlementEnabled:boolean;
};
export type ScopeDecision={
 userId:number;tenantId:number;role:string;
 authorized:true;reason:'session-membership-entitlement';
};
export function authorizeDisposableTenantScope(args:{
 principal:AuthenticatedPrincipal|null;
 requestedTenantId:number;
 membership:TenantMembership|null;
 contract:TenantContract|null;
}):ScopeDecision{
 const {principal,requestedTenantId,membership,contract}=args;
 if(!principal||!Number.isSafeInteger(principal.userId)||principal.userId<=0||
    !Number.isSafeInteger(principal.sessionVersion)||principal.sessionVersion<0||
    principal.sessionVersion!==principal.verifiedSessionVersion)
  throw Error('ALT0810C20_SESSION_UNVERIFIED');
 if(!Number.isSafeInteger(requestedTenantId)||requestedTenantId<=0)
  throw Error('ALT0810C20_INVALID_TENANT');
 // Explicit internal-operator scope is intentionally NOT granted here.
 if(principal.globalRole!=='client')throw Error('ALT0810C20_INTERNAL_ROLE_SEPARATE_GATE');
 if(!membership||membership.userId!==principal.userId||
    membership.tenantId!==requestedTenantId||membership.active!==true||
    !['client_viewer','client_admin'].includes(membership.role))
  throw Error('ALT0810C20_MEMBERSHIP_DENIED');
 if(!contract||contract.tenantId!==requestedTenantId||
    contract.status!=='active'||contract.subscriptionStatus!=='active'||
    contract.entitlementEnabled!==true)
  throw Error('ALT0810C20_ENTITLEMENT_DENIED');
 return {userId:principal.userId,tenantId:requestedTenantId,role:membership.role,
  authorized:true,reason:'session-membership-entitlement'};
}
