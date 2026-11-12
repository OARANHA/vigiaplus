import test from 'node:test';
import assert from 'node:assert/strict';
import {withTenantRlsTransaction,type TenantSqlPool} from '../lib/tenant/rls-transaction';

function recordingPool(options:{throwOn?:string}={}){
  const calls:string[]=[];
  let releases=0;
  const pool:TenantSqlPool={connect:async()=>({
    query:async(sql:string,params?:readonly unknown[])=>{
      calls.push(sql+'|'+JSON.stringify(params??[]));
      if(options.throwOn && sql===options.throwOn)throw Error('ALT086_INJECTED_FAILURE');
      return {rows:[],rowCount:0};
    },
    release:()=>{releases++;},
  })};
  return {pool,calls,getReleases:()=>releases};
}
test('ALT-08.6: runtime pinado faz BEGIN SET LOCAL COMMIT e release',async()=>{
  const r=recordingPool();
  await withTenantRlsTransaction(r.pool,17,async query=>{
    await query('SELECT 1');
  });
  assert.deepEqual(r.calls.map(s=>s.split('|')[0]),
    ['BEGIN',"SELECT set_config('app.tenant_id', $1, true)",'SELECT 1','COMMIT']);
  assert.match(r.calls[1],/\["17"\]/);
  assert.equal(r.getReleases(),1);
});
test('ALT-08.6: erro no SQL faz rollback e release; nunca COMMIT',async()=>{
  const r=recordingPool({throwOn:'SELECT broken'});
  await assert.rejects(withTenantRlsTransaction(r.pool,18,q=>q('SELECT broken')),
    /ALT086_INJECTED_FAILURE/);
  assert.deepEqual(r.calls.map(s=>s.split('|')[0]),
    ['BEGIN',"SELECT set_config('app.tenant_id', $1, true)",'SELECT broken','ROLLBACK']);
  assert.equal(r.getReleases(),1);
});
test('ALT-08.6: falha antes do BEGIN/SET LOCAL não cria sessão reutilizável',async()=>{
  for(const step of ['BEGIN',"SELECT set_config('app.tenant_id', $1, true)"]){
    const r=recordingPool({throwOn:step});
    await assert.rejects(withTenantRlsTransaction(r.pool,19,async()=>null),
      /ALT086_INJECTED_FAILURE/);
    assert.equal(r.getReleases(),1);
    assert.equal(r.calls.some(s=>s.startsWith('COMMIT|')),false);
    if(step==='BEGIN')assert.equal(r.calls.some(s=>s.startsWith('ROLLBACK|')),false);
    else assert.equal(r.calls.some(s=>s.startsWith('ROLLBACK|')),true);
  }
});
test('ALT-08.6: tenant inválido falha antes de consumir pool',async()=>{
  const r=recordingPool();
  for(const n of [0,-1,NaN,Infinity,1.2]){
    await assert.rejects(withTenantRlsTransaction(r.pool,n,async()=>null),
      /RLS_TENANT_SCOPE_REQUIRED/);
  }
  assert.equal(r.calls.length,0);
  assert.equal(r.getReleases(),0);
});
