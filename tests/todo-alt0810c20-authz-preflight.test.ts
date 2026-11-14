import test from 'node:test';
import assert from 'node:assert/strict';
import {ALT0810C20,authorizeDisposableTenantScope} from '../lib/tenant/alt0810c20-authz-preflight';
const user={userId:1001,sessionVersion:4,verifiedSessionVersion:4,globalRole:'client' as const};
const membership={userId:1001,tenantId:101,role:'client_viewer' as const,active:true};
const contract={tenantId:101,status:'active' as const,
 subscriptionStatus:'active' as const,entitlementEnabled:true};
const inputs={principal:user,requestedTenantId:101,membership,contract};
test('ALT-08.10C.20 authorizes only verified session with active membership and entitlement',()=>{
 assert.deepEqual(authorizeDisposableTenantScope(inputs),{
  userId:1001,tenantId:101,role:'client_viewer',authorized:true,
  reason:'session-membership-entitlement'
 });
 assert.equal(ALT0810C20.operationalAuthEnabled,false);
 assert.equal(ALT0810C20.productionAuthorized,false);
});
test('ALT-08.10C.20 rejects anonymous, revoked and malformed sessions',()=>{
 for(const principal of [null,{...user,verifiedSessionVersion:5},{...user,userId:0},
  {...user,sessionVersion:-1}]){
  assert.throws(()=>authorizeDisposableTenantScope({...inputs,principal}),/SESSION_UNVERIFIED/);
 }
});
test('ALT-08.10C.20 rejects tenant spoofing, revoked membership and owner shortcuts',()=>{
 assert.throws(()=>authorizeDisposableTenantScope({...inputs,requestedTenantId:202}),/MEMBERSHIP_DENIED/);
 assert.throws(()=>authorizeDisposableTenantScope({...inputs,membership:{...membership,active:false}}),/MEMBERSHIP_DENIED/);
 assert.throws(()=>authorizeDisposableTenantScope({...inputs,membership:{...membership,userId:2002}}),/MEMBERSHIP_DENIED/);
 assert.throws(()=>authorizeDisposableTenantScope({...inputs,principal:{...user,globalRole:'owner'}}),/INTERNAL_ROLE_SEPARATE_GATE/);
});
test('ALT-08.10C.20 rejects inactive contract, suspended billing and disabled entitlement',()=>{
 for(const altered of [
  {...contract,status:'suspended' as const},
  {...contract,subscriptionStatus:'suspended' as const},
  {...contract,entitlementEnabled:false},
  {...contract,tenantId:202}
 ]){
  assert.throws(()=>authorizeDisposableTenantScope({...inputs,contract:altered}),/ENTITLEMENT_DENIED/);
 }
});
