// Production Server Action regression tests; isolated PGlite and ephemeral secrets.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, '.next/server/server-reference-manifest.json'), 'utf8'));
const id = (name) => Object.entries(manifest.node).find(([,v]) => v.exportedName === name)?.[0];
const results = [];
const record = (name, pass, detail) => { results.push({name,pass,detail}); console.log(`${pass?'PASS':'FAIL'} ${name}: ${JSON.stringify(detail)}`); };
const envBase = {...process.env, NODE_ENV:'production', DEMO_MODE:'', DATABASE_URL:'', APP_PASSWORD:'', SESSION_SECRET:randomBytes(32).toString('hex')};
async function start(port, env) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','127.0.0.1'], {cwd:root,env:{...envBase,...env},detached:true,stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(`http://127.0.0.1:${port}/login`)).status===200)return child;}catch{}await new Promise(r=>setTimeout(r,300));}
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
  throw Error('Server not ready');
}
async function stop(s){const done=new Promise(r=>s.once('exit',r));try{process.kill(-s.pid,'SIGTERM');}catch{return;}await done;}
async function action(port,name,fields,cookie='') {
  assert.ok(id(name), `Missing action ${name}`);
  const f=new FormData();f.set('$ACTION_ID_'+id(name),'');for(const [k,v]of Object.entries(fields))f.set(k,String(v));
  return fetch(`http://127.0.0.1:${port}/settings`,{method:'POST',body:f,redirect:'manual',headers:{origin:`http://127.0.0.1:${port}`,cookie}});
}
async function login(port,email,password){const r=await fetch(`http://127.0.0.1:${port}/api/auth`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const demoDir=mkdtempSync(join(tmpdir(),'radar-sa-demo-'));let demo;
try{demo=await start(3116,{DEMO_MODE:'1',PGLITE_DIR:demoDir});const studio=await fetch('http://127.0.0.1:3116/api/studio');record('demo studio requires admin',studio.status===403,{status:studio.status});const vd=await fetch('http://127.0.0.1:3116/api/vigia/collect',{method:'POST',headers:{'content-type':'application/json'},body:'{"projectId":1}'});record('demo VigiaElus collection forbidden',vd.status===403,{status:vd.status});const vp=await fetch('http://127.0.0.1:3116/api/vigia/pilot',{method:'POST'});record('demo VigiaElus pilot creation forbidden',vp.status===403,{status:vp.status});for(const [name,fields]of [['createProject',{name:'qa-forbidden'}],['addEntity',{projectId:1,name:'qa-forbidden'}],['createShareLink',{projectId:1,days:7}]]){const r=await action(3116,name,fields);record('demo '+name,r.status===403,{status:r.status});}}finally{if(demo)await stop(demo);rmSync(demoDir,{recursive:true,force:true});}
const authDir=mkdtempSync(join(tmpdir(),'radar-sa-auth-'));const password=randomBytes(16).toString('hex');const adminEmail='qa-admin@example.test',memberEmail='qa-member@example.test';const env={...envBase,PGLITE_DIR:authDir,ADMIN_EMAIL:adminEmail,ADMIN_PASSWORD:password,E2E_MEMBER_EMAIL:memberEmail,E2E_MEMBER_PASSWORD:password};let auth;
try{execFileSync(process.execPath,['--import','tsx','scripts/e2e-prepare-db.ts',authDir],{cwd:root,env,stdio:'ignore'});auth=await start(3117,env);const admin=await login(3117,adminEmail,password),member=await login(3117,memberEmail,password);
await action(3117,'addEntity',{projectId:1,name:'qa-authorized'},admin);
await action(3117,'addEntity',{projectId:1,name:'qa-member-forbidden'},member);const invalid=await fetch('http://127.0.0.1:3117/api/vigia/collect',{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:'{}'});record('VigiaElus requires explicit projectId',invalid.status===400,{status:invalid.status});const unauthorized=await fetch('http://127.0.0.1:3117/api/vigia/collect',{method:'POST',headers:{cookie:member,'content-type':'application/json'},body:'{"projectId":1}'});record('VigiaElus denies unrelated project',unauthorized.status===404,{status:unauthorized.status});
const revoke=await fetch('http://127.0.0.1:3117/api/auth',{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:'{"revokeAll":true}'});assert.equal(revoke.status,200);
await action(3117,'addEntity',{projectId:1,name:'qa-revoked-forbidden'},admin);const denied=await fetch('http://127.0.0.1:3117/api/vigia/collect',{method:'POST',headers:{cookie:admin,'content-type':'application/json'},body:'{"projectId":1}'});record('VigiaElus revoked session denied',denied.status===401,{status:denied.status});
await stop(auth);auth=undefined;
const out=execFileSync(process.execPath,['--import','tsx','scripts/e2e-check-entities.ts'],{cwd:root,env,encoding:'utf8'});const rows=JSON.parse(out.trim().split('\n').at(-1));const names=rows.map(r=>r.name);record('admin action persists on own project',names.includes('qa-authorized'),{persisted:names.includes('qa-authorized')});record('member cannot mutate another project',!names.includes('qa-member-forbidden'),{persisted:names.includes('qa-member-forbidden')});record('revoked HMAC-valid session cannot mutate action',!names.includes('qa-revoked-forbidden'),{persisted:names.includes('qa-revoked-forbidden')});
}finally{if(auth)await stop(auth);rmSync(authDir,{recursive:true,force:true});}
const evidence=process.env.RADAR_E2E_EVIDENCE_DIR??join(tmpdir(),'radar-server-action-evidence');mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'server-actions.json'),JSON.stringify(results,null,2));console.log(`${results.length} checks, ${results.filter(r=>r.pass).length} passed`);process.exitCode=results.every(r=>r.pass)?0:1;
