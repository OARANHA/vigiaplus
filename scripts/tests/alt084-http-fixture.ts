/** ALT-08.4: synthetic auth/entitlement fixtures in CI-local PGlite only. */
import {resolve} from 'node:path';
import {getDb} from '../../lib/db';
import {users,tenants,memberships,subscriptions,tenantFeatures} from '../../lib/db/schema';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||
 e.ALT084_EPHEMERAL_HTTP!=='1'||e.DATABASE_URL||
 !e.PGLITE_DIR||!e.RUNNER_TEMP||
 !resolve(e.PGLITE_DIR).startsWith(resolve(e.RUNNER_TEMP)+'/')) {
  throw Error('ALT084_HTTP_AUTH_FIXTURES_LOCAL_ONLY');
}
const db=await getDb();
const [a,b]=await db.insert(tenants).values([
 {name:'ALT084 client A',slug:'alt084-http-a'},
 {name:'ALT084 client B',slug:'alt084-http-b'},
]).returning();
if(a.id!==1||b.id!==2)throw Error('ALT084_HTTP_TENANT_IDS_NOT_EMPTY');
const us=await db.insert(users).values([
 {name:'ALT084 A',email:'alt084-a@example.invalid',passwordHash:'synthetic',role:'member',
  globalRole:null,mustChangePassword:0,sessionVersion:0},
 {name:'ALT084 B',email:'alt084-b@example.invalid',passwordHash:'synthetic',role:'member',
  globalRole:null,mustChangePassword:0,sessionVersion:0},
]).returning();
await db.insert(memberships).values([
 {tenantId:a.id,userId:us[0].id,role:'client_admin'},
 {tenantId:b.id,userId:us[1].id,role:'client_viewer'},
]);
await db.insert(subscriptions).values([
 {tenantId:a.id,planKey:'trial',status:'active'},
 {tenantId:b.id,planKey:'trial',status:'active'},
]);
await db.insert(tenantFeatures).values([
 {tenantId:a.id,featureKey:'reputation_dual',enabled:1,reason:'ALT084 test only'},
 {tenantId:b.id,featureKey:'reputation_dual',enabled:1,reason:'ALT084 test only'},
]);
process.stdout.write(JSON.stringify({a:us[0].id,b:us[1].id})+'\n');
