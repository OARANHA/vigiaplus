import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALT0810C34, policyExpressionDigest, preflightExclusiveTenantPolicy,
  withDisposableScopedRead,
} from '../lib/db/alt0810c34-policy-pool-guard';
import type { DedicatedPool, DedicatedClient } from '../lib/db/alt0810c33-operational-contract';

test('ALT-08.10C.34 remains explicitly NO-GO',()=>{
  assert.equal(ALT0810C34.stagingEnabled,false);
  assert.equal(ALT0810C34.productionEnabled,false);
  assert.equal(ALT0810C34.operationalRlsAuthorized,false);
  assert.equal(ALT0810C34.reviewedPolicyManifestAvailable,false);
});

function mockPool(failRollback=false) {
  const log:string[]=[];
  const releases:boolean[]=[];
  const client:DedicatedClient={
    async query(sql:string,params?:unknown[]){
      log.push(sql+(params?' '+JSON.stringify(params):''));
      if (sql==='ROLLBACK'&&failRollback) throw Error('LINK_BROKEN');
      return {rows:[{value:1}],rowCount:1};
    },
    release(discard=false){releases.push(discard);},
  };
  let connections=0;
  const pool:DedicatedPool={async connect(){connections++;return client;}};
  return {pool,log,releases,connections:()=>connections};
}

test('ALT-08.10C.34 rejects invalid scope before connecting',async()=>{
  const s=mockPool();
  await assert.rejects(withDisposableScopedRead(s.pool,{tenantId:0,readerRole:'reader'},
    async db=>db.query('SELECT 1')), /ALT0810C34_SCOPE_DENIED/);
  await assert.rejects(withDisposableScopedRead(s.pool,{tenantId:101,readerRole:'reader";DROP ROLE x'},
    async db=>db.query('SELECT 1')), /ALT0810C34_SCOPE_DENIED/);
  assert.equal(s.connections(),0);
});

test('ALT-08.10C.34 owns READ ONLY transaction and cleans after callback',async()=>{
  const s=mockPool();
  const value=await withDisposableScopedRead(s.pool,{tenantId:101,readerRole:'reader'},async db=>{
    const rows=await db.query('SELECT value FROM evidence WHERE id=$1',[1]);
    return Number(rows.rows[0].value);
  });
  assert.equal(value,1);
  assert.deepEqual(s.releases,[false]);
  assert.deepEqual(s.log,[
    'BEGIN READ ONLY','SET LOCAL ROLE "reader"',
    'SELECT set_config($1,$2,true) ["app.tenant_id","101"]',
    'SELECT value FROM evidence WHERE id=$1 [1]','ROLLBACK',
  ]);
});

test('ALT-08.10C.34 blocks COMMIT, SQL batching, unsafe statements and mutable GUC',async()=>{
  for(const sql of [
    'COMMIT','ROLLBACK','BEGIN','SET ROLE postgres',
    'SELECT 1; COMMIT','SELECT 1 -- comment','SELECT 1 /* comment */',
    "SELECT set_config('app.tenant_id','999',false)",
    'WITH changed AS (DELETE FROM evidence RETURNING id) SELECT id FROM changed',
    'UPDATE evidence SET id=2','SELECT pg_terminate_backend(1)',
  ]){
    const s=mockPool();
    await assert.rejects(withDisposableScopedRead(s.pool,{tenantId:101,readerRole:'reader'},
      async db=>db.query(sql)),/ALT0810C34_QUERY_DENIED/);
    assert.deepEqual(s.releases,[false],sql);
    assert.equal(s.log.at(-1),'ROLLBACK',sql);
    assert.equal(s.log.some(x=>x===sql),false,sql);
  }
});

test('ALT-08.10C.34 callback errors rollback; cleanup failure discards',async()=>{
  for(const broken of [false,true]){
    const s=mockPool(broken);
    await assert.rejects(withDisposableScopedRead(s.pool,{tenantId:101,readerRole:'reader'},
      async()=>{throw Error('APP_ERROR')}),/APP_ERROR/);
    assert.deepEqual(s.releases,[broken]);
  }
});

test('ALT-08.10C.34 policy contract denies malformed metadata before querying',async()=>{
  const scope={schema:'private',table:'evidence',readerRole:'reader',executorRole:'executor',
    expectedPolicyName:'tenant_only',expectedUsingSha256:policyExpressionDigest('tenant_id=101')};
  let queried=0;
  const db={async query(){queried++;return {rows:[],rowCount:0}}};
  await assert.rejects(preflightExclusiveTenantPolicy(db,{...scope,expectedPolicyName:'bad;drop'}),
    /ALT0810C34_POLICY_CONTRACT_DENIED/);
  await assert.rejects(preflightExclusiveTenantPolicy(db,{...scope,expectedUsingSha256:'wrong'}),
    /ALT0810C34_POLICY_CONTRACT_DENIED/);
  assert.equal(queried,0);
});
