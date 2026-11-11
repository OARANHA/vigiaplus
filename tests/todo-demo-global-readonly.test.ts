import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { NextRequest } from 'next/server';
import { PGlite } from '@electric-sql/pglite';
import { proxy } from '../proxy';
import { isDemoReadMethod, isDemoSafeRequest } from '../lib/demo-readonly';

const originalDemo = process.env.DEMO_MODE;

function filesUnder(root: string): string[] {
  const files:string[] = [];
  for (const entry of readdirSync(root)) {
    const path=join(root,entry);
    if (statSync(path).isDirectory()) files.push(...filesUnder(path));
    else if (entry==='route.ts') files.push(path);
  }
  return files;
}

function urlForRoute(file: string): string {
  const dir=relative(join(process.cwd(),'app','api'),file).replaceAll(sep,'/');
  const path=dir.replace(/\/route\.ts$/, '').replace(/\[\.\.\.[^\]]+\]/g,'qa')
    .replace(/\[[^\]]+\]/g,'qa');
  return 'http://localhost:3000/api/'+path;
}

test('SEC-03: política de leitura nega método ausente, mutação e rotas cron GET',()=>{
  for (const method of ['GET','HEAD','OPTIONS']) {
    assert.equal(isDemoReadMethod(method),true);
    assert.equal(isDemoSafeRequest(method,'/api/health'),true);
  }
  for(const method of [null,undefined,'POST','PUT','PATCH','DELETE','TRACE','CONNECT','post']) {
    assert.equal(isDemoReadMethod(method),false,String(method));
    assert.equal(isDemoSafeRequest(method,'/api/console/tenants'),false,String(method));
  }
  for(const path of ['/api/cron/daily','/api/cron/reports','/api/cron',
    '/api/webhook','/api/webhooks','/api/webhooks/billing']) {
    assert.equal(isDemoSafeRequest('GET',path),false,path);
  }
});

test('SEC-03: todos os endpoints app/api atuais recusam POST/PUT/PATCH/DELETE no proxy e não alteram banco', async()=>{
  process.env.DEMO_MODE='1';
  const client=new PGlite();
  try{
    await client.exec('CREATE TABLE state_probe(id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
    await client.exec('INSERT INTO state_probe(id,value) VALUES(1,17)');
    const routes=filesUnder(join(process.cwd(),'app','api'));
    assert.ok(routes.length>=30,'Inventário de API muito pequeno; verificar varredura');
    let unsafePassed=0;
    for(const file of routes){
      for(const method of ['POST','PUT','PATCH','DELETE']) {
        const req=new NextRequest(urlForRoute(file),{
          method,headers:{'x-vigia-request-method':'GET'},
        });
        const res=proxy(req);
        if(res.status!==403){
          unsafePassed++;
          await client.exec('UPDATE state_probe SET value=999 WHERE id=1');
        }
        assert.equal(res.status,403,method+' '+urlForRoute(file));
        assert.equal(res.headers.get('Cache-Control'),'no-store');
      }
    }
    assert.equal(unsafePassed,0);
    const snapshot=await client.query<{value:number}>('SELECT value FROM state_probe WHERE id=1');
    assert.equal(snapshot.rows[0].value,17);
  }finally{
    if(originalDemo===undefined)delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE=originalDemo;
    await client.close();
  }
});

test('SEC-03: páginas e endpoints operacionais estão cobertos, sem precisar do cookie',()=>{
  process.env.DEMO_MODE='1';
  try{
    for(const path of ['/console','/portal','/impostazioni/account',
      '/api/auth','/api/cron/daily','/api/notifications/channels',
      '/api/console/plans','/api/console/invitations']) {
      for(const method of ['POST','PUT','PATCH','DELETE']){
        const response=proxy(new NextRequest('http://localhost:3000'+path,{method}));
        assert.equal(response.status,403,method+' '+path);
      }
    }
    for(const path of ['/api/cron/daily','/api/cron/reports','/api/webhooks/stripe']){
      assert.equal(proxy(new NextRequest('http://localhost:3000'+path,{method:'GET'})).status,403);
    }
    assert.equal(proxy(new NextRequest('http://localhost:3000/api/health',{method:'GET'})).status,200);
    assert.equal(proxy(new NextRequest('http://localhost:3000/portal',{method:'GET'})).status,200);
    const authSrc=readFileSync('lib/auth.ts','utf8');
    const tenantSrc=readFileSync('lib/tenant/context.ts','utf8');
    const authRouteSrc=readFileSync('app/api/auth/route.ts','utf8');
    assert.match(authSrc,/isDemoReadMethod\(method\)/);
    assert.match(tenantSrc,/isDemoReadMethod\(method\)/);
    assert.match(authRouteSrc,/if \(isDemoMode\(\)\)/);
    assert.match(readFileSync('lib/action-auth.ts','utf8'),/isDemoMode\(\) \? null/);
  }finally{
    if(originalDemo===undefined)delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE=originalDemo;
  }
});

test('SEC-03: autenticação POST isolada recusa a demo antes do banco',async()=>{
  process.env.DEMO_MODE='1';
  try{
    const {POST}=await import('../app/api/auth/route');
    const result=await POST(new Request('http://localhost:3000/api/auth',{
      method:'POST',body:JSON.stringify({email:'qualquer@exemplo.test',password:'errada'}),
    }));
    assert.equal(result.status,403);
    assert.equal((await result.json()).error,'DEMO_READ_ONLY');
  }finally{
    if(originalDemo===undefined)delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE=originalDemo;
  }
});
