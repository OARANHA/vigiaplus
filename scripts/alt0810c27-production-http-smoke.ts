/**
 * ALT-08.10C.27: production HTTP smoke for both Next start and standalone.
 * Runs on ephemeral CI runner, without database URLs, credentials or Neon.
 */
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn, type ChildProcess} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {signSession,SESSION_COOKIE} from '../lib/session';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
 e.ALT0810C27_EPHEMERAL!=='1'||e.DATABASE_URL||e.RLS_DATABASE_URL||
 e.NODE_ENV==='production'||!e.RUNNER_TEMP)
 throw Error('ALT0810C27_DISPOSABLE_CI_ONLY');
const root=process.cwd();
const standalone=resolve(root,'.next/standalone/server.js');
const manifest=resolve(root,'.next/server/app-paths-manifest.json');
const fixtureRoute=resolve(root,'app/api/ci/alt0810c25/route.ts');
assert.equal(existsSync(fixtureRoute),false,'CI route remains in operational App Router');
assert.equal(existsSync(standalone),true,'Next standalone server.js missing');
assert.equal(existsSync(manifest),true,'Next app-paths manifest missing');
assert.doesNotMatch(readFileSync(manifest,'utf8'),/alt0810c25/i);
const docker=readFileSync(resolve(root,'deploy/Dockerfile'),'utf8');
const ignore=readFileSync(resolve(root,'.dockerignore'),'utf8');
assert.match(docker,/RUN npm ci/);
assert.match(docker,/RUN npm run build/);
assert.match(docker,/COPY --from=builder --chown=nextjs:nodejs \/app\/\.next\/standalone/);
assert.match(docker,/CMD \["node", "server\.js"\]/);
assert.match(ignore,/^\.next\s*$/m);
assert.match(ignore,/^node_modules\s*$/m);
assert.doesNotMatch(docker,/npm install\s+--no-save[^\n]*pg/);
const secret='Alt0810C27_Only_CI_Ephemeral_Secret_2026_A1B2C3D4';
process.env.SESSION_SECRET=secret; // fixture-only signer matches the child server
const cookie=`${SESSION_COOKIE}=${signSession(1001,0)}`;
async function smoke(label:string,command:string,args:string[],port:number){
 const output:string[]=[];
 const child:ChildProcess=spawn(command,args,{
  cwd:root,
  env:{...e,NODE_ENV:'production',DEMO_MODE:'0',
   DATABASE_URL:'',RLS_DATABASE_URL:'',SESSION_SECRET:secret,
   HOSTNAME:'127.0.0.1',PORT:String(port),NEXT_TELEMETRY_DISABLED:'1'},
  stdio:['ignore','pipe','pipe'],
 });
 child.stdout?.on('data',(b:Buffer)=>output.push(String(b).slice(-500)));
 child.stderr?.on('data',(b:Buffer)=>output.push(String(b).slice(-500)));
 try{
  let result:Response|null=null;
  for(let i=0;i<35;i++){
   if(child.exitCode!==null)throw Error(label+' crashed: '+output.slice(-6).join('').slice(-1800));
   try{
    const r=await fetch(`http://127.0.0.1:${port}/api/ci/alt0810c25?tenant=101`,{
     headers:{cookie},redirect:'manual',signal:AbortSignal.timeout(1700)});
    if(r.status===404){result=r;break}
    if(r.status!==502&&r.status!==503)
     throw Error(label+' CI-only route responded '+r.status+' instead of 404');
   }catch(err){
    if(err instanceof Error&&err.message.includes('instead of 404'))throw err;
   }
   await delay(900);
  }
  assert.ok(result,label+' must return 404 for VALID signed session; '+output.slice(-5).join('').slice(-1200));
  assert.equal(result.status,404);
  console.log('ALT0810C27 '+label+': production signed-session HTTP 404; no CI route or DB connection');
 }finally{
  if(child.exitCode===null){
   child.kill('SIGTERM');
   for(let i=0;i<15&&child.exitCode===null;i++)await delay(100);
   if(child.exitCode===null)child.kill('SIGKILL');
  }
 }
}
async function main():Promise<void>{
 await smoke('next-start',process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3227'],3227);
 await smoke('standalone',process.execPath,[standalone],3228);
 console.log('ALT0810C27: production HTTP smoke and static Docker packaging contract passed; no Docker daemon, no deploy');
}
void main().catch(error=>{
 console.error('ALT0810C27 production smoke failed:',error instanceof Error?error.message:String(error));
 process.exitCode=1;
});
