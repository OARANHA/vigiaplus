/**
 * ALT-08.3 — disposable E2E fixtures, never against remote DB.
 * Inserts four synthetic identities and two tenants for HTTP auth gates.
 */
import { resolve } from 'node:path';
import { getDb } from '../../lib/db';
import { users, tenants, memberships, notificationWorkerRuns, notificationDeliveries } from '../../lib/db/schema';

async function main() {
  if (process.env.ALT083_EPHEMERAL_HTTP !== '1' || process.env.DATABASE_URL
      || process.env.DEMO_MODE === '1' || !process.env.PGLITE_DIR
      || !process.env.RUNNER_TEMP
      || !resolve(process.env.PGLITE_DIR).startsWith(resolve(process.env.RUNNER_TEMP)+'/')) {
    throw new Error('ALT083 fixtures allowed only in isolated temporary PGlite');
  }
  const db=await getDb();
  const [a,b]=await db.insert(tenants).values([
    {name:'ALT083 A',slug:'alt083-client-a'},
    {name:'ALT083 B',slug:'alt083-client-b'},
  ]).returning();
  const identities=await db.insert(users).values([
    {name:'ALT083 owner',email:'alt083-owner@example.invalid',passwordHash:'synthetic-only',
      role:'member',globalRole:'owner',mustChangePassword:0,sessionVersion:0},
    {name:'ALT083 analyst',email:'alt083-analyst@example.invalid',passwordHash:'synthetic-only',
      role:'member',globalRole:'analyst',mustChangePassword:0,sessionVersion:0},
    {name:'ALT083 client A',email:'alt083-a@example.invalid',passwordHash:'synthetic-only',
      role:'member',globalRole:null,mustChangePassword:0,sessionVersion:0},
    {name:'ALT083 client B',email:'alt083-b@example.invalid',passwordHash:'synthetic-only',
      role:'member',globalRole:null,mustChangePassword:0,sessionVersion:0},
  ]).returning();
  await db.insert(memberships).values([
    {tenantId:a.id,userId:identities[2].id,role:'client_admin'},
    {tenantId:b.id,userId:identities[3].id,role:'client_viewer'},
  ]);
  await db.insert(notificationWorkerRuns).values({
    runId:'alt083-test-real-worker',worker:'notify',status:'success',
    startedAt:new Date(),finishedAt:new Date(),durationMs:1,exitCode:0,
    summary:{tenants:2,entregas:{sent:0,failed:0},secret:'DO-NOT-LEAK-ALT083',
      destination:'sensitive@example.invalid'},
  });
  await db.insert(notificationDeliveries).values([
    {tenantId:a.id,channel:'ledger',destination:'internal',
      kind:'incident',title:'Tenant A evidence',message:'PRIVATE-ALT083-A',
      status:'queued',dedupeKey:'alt083-a'},
    {tenantId:b.id,channel:'ledger',destination:'internal',
      kind:'incident',title:'Tenant B evidence',message:'PRIVATE-ALT083-B',
      status:'queued',dedupeKey:'alt083-b'},
  ]);
  process.stdout.write(JSON.stringify({
    owner:identities[0].id,analyst:identities[1].id,
    clientA:identities[2].id,clientB:identities[3].id,
  })+'\n');
}
main().then(()=>process.exit(0)).catch(()=>{
  console.error('ALT083: fixture setup failed');process.exit(1);
});
