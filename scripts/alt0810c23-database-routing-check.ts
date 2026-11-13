/** ALT-08.10C.23: architectural CI guard; never contacts DB/network. */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {inspectNextPgBinding,type NextPgBindingEvidence} from '../lib/tenant/alt0810c23-next-pg-runtime-gate';
const root=process.cwd();
if(process.env.DATABASE_URL||process.env.RLS_DATABASE_URL)
 throw Error('ALT0810C23_OFFLINE_INSPECTION_ONLY');
const db=readFileSync(resolve(root,'lib/db/index.ts'),'utf8');
const session=readFileSync(resolve(root,'lib/session-auth.ts'),'utf8');
const tenantScope=readFileSync(resolve(root,'lib/tenant/scope.ts'),'utf8');
const e2e=readFileSync(resolve(root,'scripts/tests/alt083-http-ci.sh'),'utf8');
const pg=readFileSync(resolve(root,'scripts/tests/alt0810c21-http-pg-authz.test.ts'),'utf8');
assert.match(db,/drizzle-orm\/neon-http/);
assert.match(db,/drizzle-orm\/pglite/);
assert.match(db,/if\s*\(process\.env\.DATABASE_URL\)/);
assert.match(session,/verifySession/);
assert.match(session,/sessionVersion/);
assert.match(tenantScope,/TenantScopeUnavailableError/);
assert.match(tenantScope,/transaction/);
assert.match(e2e,/PGLITE_DIR/);
assert.match(e2e,/next dev/);
assert.match(pg,/new Client\(conn\)/);
assert.match(pg,/SET LOCAL ROLE/);
const evidence:NextPgBindingEvidence={
 actualNextRoute:true,
 signedCookieVerified:true,
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
const report=inspectNextPgBinding(evidence);
assert.equal(report.ready,false);
assert.ok(report.missingEvidence.includes('tenantScopeOnSameConnection'));
process.stdout.write('ALT0810C23 ARCHITECTURE GATE '+JSON.stringify({
 version:'alt0810c23-next-pg-transaction-readiness-v1',
 adapter:'neon-http-or-pglite',
 nextRouteDatabase:'pglite-disposable',
 postgresFixture:'pg16-disposable-separate-http-server',
 missingEvidence:report.missingEvidence,
 productionAuthorized:false,
 })+'\n');
