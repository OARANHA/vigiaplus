import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatedRlsTenantId, withTenantRlsTransaction,
  type TenantSqlPool, type TenantSqlClient,
} from '../lib/tenant/rls-transaction';

test('ALT-08.3: tenant ID requer número positivo seguro, nunca escopo owner global',()=>{
  for (const id of [null,undefined,0,-1,1.1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>validatedRlsTenantId(id as number|null|undefined),
      /RLS_TENANT_SCOPE_REQUIRED/);
  }
  assert.equal(validatedRlsTenantId(42),42);
});

test('ALT-08.3: BEGIN, SET LOCAL parametrizado, operação, COMMIT e release',async()=>{
  const statements:{sql:string;params?:readonly unknown[]}[]=[];
  let releases=0;
  const client:TenantSqlClient={
    async query(sql,params) {
      statements.push({sql,params});
      return {rows:[{ok:true}],rowCount:1};
    },
    release(){releases++},
  };
  const pool:TenantSqlPool={connect:async()=>client};
  const r=await withTenantRlsTransaction(pool,17,async(query)=>{
    const v=await query('SELECT 42');
    return v.rows[0].ok;
  });
  assert.equal(r,true);
  assert.deepEqual(statements.map(s=>s.sql),[
    'BEGIN',"SELECT set_config('app.tenant_id', $1, true)",'SELECT 42','COMMIT'
  ]);
  assert.deepEqual(statements[1].params,['17']);
  assert.equal(releases,1);
});

test('ALT-08.3: erro no callback produz rollback e release, nunca commit',async()=>{
  const statements:string[]=[];
  let releases=0;
  const client:TenantSqlClient={
    async query(sql) {statements.push(sql);return {rows:[],rowCount:0}},
    release(){releases++},
  };
  await assert.rejects(withTenantRlsTransaction({connect:async()=>client},29,
    async()=>{throw new Error('test failure')}),/test failure/);
  assert.deepEqual(statements,[
    'BEGIN',"SELECT set_config('app.tenant_id', $1, true)",'ROLLBACK'
  ]);
  assert.equal(releases,1);
});

test('ALT-08.3: falhas de configuração ou COMMIT exigem rollback/release',async()=>{
  for (const failAt of ["SELECT set_config('app.tenant_id', $1, true)",'COMMIT']) {
    let released=0;
    const statements:string[]=[];
    const client:TenantSqlClient={
      async query(sql){
        statements.push(sql);
        if(sql===failAt)throw new Error('database failed');
        return {rows:[],rowCount:0};
      },
      release(){released++},
    };
    await assert.rejects(withTenantRlsTransaction({connect:async()=>client},1,
      async()=>42),/database failed/);
    assert.ok(statements.includes('ROLLBACK'));
    assert.equal(released,1);
  }
});

test('ALT-08.3: tenant ID inválido não abre conexão',async()=>{
  let connected=0;
  await assert.rejects(withTenantRlsTransaction({connect:async()=>{
    connected++;throw new Error('must never connect');
  }},0,async()=>42),/RLS_TENANT_SCOPE_REQUIRED/);
  assert.equal(connected,0);
});
