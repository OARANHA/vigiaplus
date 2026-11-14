import test from 'node:test';
import assert from 'node:assert/strict';
import type { TenantContext } from '../lib/tenant/context';
import { trustedRlsTenantForClient, withAuthenticatedClientRls } from '../lib/tenant/rls-runtime';
import type { TenantSqlClient, TenantSqlPool } from '../lib/tenant/rls-transaction';

function ctx(role: TenantContext['role']='client_viewer', tenantId:number|null=19):TenantContext {
  return {
    userId:123,userName:'synthetic',role,tenantId,system:false,surface:'app',
    density:'basico',vocabulary:'leigo',ip:null,requestId:'test',
  };
}
test('ALT-08.3 runtime bridge: only authenticated client context on app is accepted',()=>{
  assert.equal(trustedRlsTenantForClient(ctx()),19);
  assert.equal(trustedRlsTenantForClient(ctx('client_admin',22)),22);
  for(const role of ['owner','analyst'] as const) {
    assert.throws(()=>trustedRlsTenantForClient(ctx(role)),/RLS_CLIENT_CONTEXT_REQUIRED/);
  }
  assert.throws(()=>trustedRlsTenantForClient({...ctx(),system:true}),/RLS_CLIENT_CONTEXT_REQUIRED/);
  assert.throws(()=>trustedRlsTenantForClient({...ctx(),surface:'console'}),/RLS_CLIENT_CONTEXT_REQUIRED/);
  assert.throws(()=>trustedRlsTenantForClient({...ctx(),surface:'analyst'}),/RLS_CLIENT_CONTEXT_REQUIRED/);
  assert.throws(()=>trustedRlsTenantForClient({...ctx(),userId:0}),/RLS_CLIENT_CONTEXT_REQUIRED/);
  for(const tenantId of [null,0,-1,NaN,1.5,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>trustedRlsTenantForClient(ctx('client_viewer',tenantId)),
      /RLS_TENANT_SCOPE_REQUIRED/);
  }
});
test('ALT-08.3 runtime bridge: sets signed-session tenant scope in same transaction',async()=>{
  const log:string[]=[];
  let release=0;
  const client:TenantSqlClient={
    async query(sql,params) {
      log.push(sql+':'+JSON.stringify(params??[]));
      return {rows:[{ok:1}],rowCount:1};
    },
    release(){release++},
  };
  const pool:TenantSqlPool={connect:async()=>client};
  const data=await withAuthenticatedClientRls(ctx('client_admin',27),pool,
    async query=>(await query('SELECT id FROM notification_deliveries WHERE tenant_id=$1',[27])).rows[0]);
  assert.deepEqual(data,{ok:1});
  assert.deepEqual(log,[
    'BEGIN:[]',
    "SELECT set_config('app.tenant_id', $1, true):[\"27\"]",
    'SELECT id FROM notification_deliveries WHERE tenant_id=$1:[27]',
    'COMMIT:[]',
  ]);
  assert.equal(release,1);
});
test('ALT-08.3 runtime bridge: unauthorized request opens no pool connection',async()=>{
  let count=0;
  const pool:TenantSqlPool={connect:async()=>{count++;throw Error('unexpected connect');}};
  await assert.rejects(withAuthenticatedClientRls(ctx('owner'),pool,async()=>null),
    /RLS_CLIENT_CONTEXT_REQUIRED/);
  assert.equal(count,0);
});
