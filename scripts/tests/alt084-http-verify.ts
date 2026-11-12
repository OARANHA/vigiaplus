/** ALT-08.4: HTTP real com cookies assinados, autorização e Neon RLS A/B. */
import assert from 'node:assert/strict';
import {signSession,SESSION_COOKIE} from '../../lib/session';

const ids=JSON.parse(process.env.ALT084_HTTP_IDS||'null') as {a:number;b:number}|null;
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||
  process.env.ALT084_EPHEMERAL_HTTP!=='1'||
  process.env.VIGIA_ALT084_EVIDENCE_MODE!=='ci-read-only'||
  process.env.DATABASE_URL||!ids||![ids.a,ids.b].every(Number.isSafeInteger))
  throw Error('ALT084_HTTP_CI_ONLY');
const origin='http://127.0.0.1:3199';
async function request(id?:number,tenant?:number,cookieOverride?:string){
  const cookie=cookieOverride??(id?signSession(id,0):null);
  const suffix=tenant!=null?`?tenant_id=${tenant}`:'';
  return fetch(origin+'/api/app/evidence'+suffix,{
    headers:cookie?{Cookie:`${SESSION_COOKIE}=${cookie}`}:{},
    redirect:'manual',signal:AbortSignal.timeout(25000),
  });
}
let live=false;
for(let attempt=0;attempt<50;attempt++){
  try {
    const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(2000)});
    if(r.status<500){live=true;break}
  }catch{/* startup */}
  await new Promise(r=>setTimeout(r,1000));
}
assert.equal(live,true,'Next HTTP server did not start');
const anonymous=await request();
assert.equal(anonymous.status,401,'anonymous must be denied');
const invalid=await request(undefined,undefined,'x.0.'+'0'.repeat(64));
assert.equal(invalid.status,401,'forged signature must be denied');

const a=await request(ids.a,2);
assert.equal(a.status,200,'A requires signed DB-backed auth, own tenant and entitlement');
assert.equal(a.headers.get('cache-control'),'no-store');
const aBody=await a.json() as {tenantId:number;items:{title:string;projectName:string}[]};
assert.equal(aBody.tenantId,1,'tenant ID from session membership, not spoofed query');
assert.deepEqual(aBody.items.map(m=>m.title),['ALT084_HTTP_A']);
assert.ok(JSON.stringify(aBody).includes('ALT084 Synthetic Project A'));
assert.ok(!JSON.stringify(aBody).includes('ALT084_HTTP_B'));

const b=await request(ids.b,1);
assert.equal(b.status,200,'B signed viewer should read only B');
const bBody=await b.json() as {tenantId:number;items:{title:string;projectName:string}[]};
assert.equal(bBody.tenantId,2);
assert.deepEqual(bBody.items.map(m=>m.title),['ALT084_HTTP_B']);
assert.ok(!JSON.stringify(bBody).includes('ALT084_HTTP_A'));
const aAgain=await request(ids.a);
assert.equal(aAgain.status,200,'no scope leak after client B');
const repeated=await aAgain.json() as {items:{title:string}[]};
assert.deepEqual(repeated.items.map(m=>m.title),['ALT084_HTTP_A']);
process.stdout.write('ALT084 HTTP Neon WS: signed auth, spoof denied, tenant A/B, no leakage VERIFIED\n');
