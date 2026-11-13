/**
 * ALT-08.3 — real HTTP authentication and tenant separation, loopback only.
 * Uses signed cookies with DB-backed session_version; not mock route handlers.
 */
import assert from 'node:assert/strict';
import { signSession, SESSION_COOKIE } from '../../lib/session';

type Ids={owner:number;analyst:number;clientA:number;clientB:number;revokedOwner:number};
const ids:Ids=JSON.parse(process.env.ALT083_FIXTURE_IDS||'null');
const origin='http://127.0.0.1:3199';
if(process.env.ALT083_EPHEMERAL_HTTP!=='1' || process.env.DATABASE_URL
  || !process.env.CI || !process.env.RUNNER_TEMP
  || !ids || ![ids.owner,ids.analyst,ids.clientA,ids.clientB,ids.revokedOwner].every(Number.isInteger)){
  throw new Error('ALT083 HTTP check requires isolated CI fixtures');
}
async function request(id:number|undefined,headers:Record<string,string>={}){
  const cookies: Record<string,string> = id
    ? { Cookie: `${SESSION_COOKIE}=${signSession(id,0)}` } : {};
  return fetch(origin+'/api/console/notifications/operations?tenant_id=999999',{
    headers:{...cookies,...headers},
    redirect:'manual',signal:AbortSignal.timeout(30000),
  });
}
async function main(){
  let live=false;
  for(let n=0;n<40;n++){
    try{
      const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(2000)});
      if(r.status<500){live=true;break;}
    }catch{/* app is starting */}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(live,true,'HTTP server unavailable');
  const anonymous=await request(undefined);
  assert.equal(anonymous.status,401,'unauthenticated must fail');
  const analyst=await request(ids.analyst);
  assert.equal(analyst.status,403,'analyst must not read owner operations');
  for(const id of [ids.clientA,ids.clientB]){
    const response=await request(id,{'x-tenant-id':'1'});
    assert.equal(response.status,403,'clients cannot select a tenant or inspect global queue');
  }
  const owner=await request(ids.owner,{'x-tenant-id':'999999'});
  assert.equal(owner.status,200,'owner requires valid DB-backed session');
  assert.equal(owner.headers.get('cache-control'),'no-store');
  const raw=await owner.text();
  assert.ok(!raw.includes('DO-NOT-LEAK-ALT083'),'secret in summary');
  assert.ok(!raw.includes('sensitive@example.invalid'),'recipient leaked');
  assert.ok(!raw.includes('PRIVATE-ALT083-A'),'tenant A evidence leaked');
  assert.ok(!raw.includes('PRIVATE-ALT083-B'),'tenant B evidence leaked');
  const data=JSON.parse(raw) as {
    worker:{status:string;runs:{summary:Record<string,unknown>}[]};
    queue:{pending:number};
  };
  assert.ok(data.queue.pending>=2,'owner observes aggregate of both synthetic tenants');
  assert.ok(data.worker.runs.some(r=>r.summary.tenants===2));
  // ALT-08.10C.22: real Next.js route must reject a still HMAC-valid
  // cookie whose session version was superseded in the disposable DB.
  const revokedCookie=signSession(ids.revokedOwner,0);
  const stale=await fetch(origin+'/api/console/notifications/operations?tenant_id=999999',{
    headers:{Cookie:`${SESSION_COOKIE}=${revokedCookie}`},redirect:'manual'
  });
  assert.equal(stale.status,401,'DB-revoked session must fail despite valid signature');
  const currentCookie=signSession(ids.revokedOwner,2);
  const valid=await fetch(origin+'/api/console/notifications/operations?tenant_id=999999',{
    headers:{Cookie:`${SESSION_COOKIE}=${currentCookie}`},redirect:'manual'
  });
  assert.equal(valid.status,200,'same user with verified current DB session may enter owner-only route');
  assert.equal(valid.headers.get('cache-control'),'no-store');
  const ignoredSpoof=await request(ids.clientA,{'x-tenant-id':String(ids.owner)});
  assert.equal(ignoredSpoof.status,403,'client cannot impersonate owner by forged tenant header');
  const badSignature=await fetch(origin+'/api/console/notifications/operations',{
    headers:{Cookie:`${SESSION_COOKIE}=1.0.${'0'.repeat(64)}`},redirect:'manual'
  });
  assert.equal(badSignature.status,401);
  process.stdout.write('ALT083+ALT0810C22 Next.js: owner 200; analyst/client 403; forged/anonymized/revoked 401; current session 200; summary sanitized\n');
}
main().catch(e=>{
  console.error('ALT083 HTTP failure:',e instanceof Error?e.message:'unknown');
  process.exitCode=1;
});
