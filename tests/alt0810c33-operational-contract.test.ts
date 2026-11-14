import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALT0810C33,withDedicatedTenantClient,preflightTenantRls,
  type DedicatedClient,type DedicatedPool,
} from '../lib/db/alt0810c33-operational-contract';

test('ALT-08.10C.33 default deny operational activation',()=>{
  assert.equal(ALT0810C33.stagingEnabled,false);
  assert.equal(ALT0810C33.productionEnabled,false);
  assert.equal(ALT0810C33.schemaMigrationAuthorized,false);
  assert.equal(ALT0810C33.operationalRlsAuthorized,false);
});

function poolFor(script:(sql:string)=>Promise<void>|void) {
  const log:string[]=[];
  let freed=false,discarded=false,acquired=0;
  const client:DedicatedClient={
    async query(sql:string){
      log.push(sql);await script(sql);
      return {rows:[],rowCount:0};
    },
    release(discard=false){assert.equal(freed,false);freed=true;discarded=discard},
  };
  const pool:DedicatedPool={async connect(){acquired++;return client}};
  return {pool,log,get:()=>({freed,discarded,acquired})};
}

test('ALT-08.10C.33 dedicated connection success + cleanup before release',async()=>{
  const context=poolFor(()=>{});
  const result=await withDedicatedTenantClient(context.pool,async db=>{
    await db.query('BEGIN');await db.query('SET LOCAL ROLE reader');
    return 'isolated';
  });
  assert.equal(result,'isolated');
  assert.deepEqual(context.log,['BEGIN','SET LOCAL ROLE reader','ROLLBACK']);
  assert.deepEqual(context.get(),{freed:true,discarded:false,acquired:1});
});

test('ALT-08.10C.33 callback failure triggers rollback + releases',async()=>{
  const context=poolFor(()=>{});
  await assert.rejects(withDedicatedTenantClient(context.pool,async db=>{
    await db.query('BEGIN');throw Error('READ_FAILED');
  }),/READ_FAILED/);
  assert.deepEqual(context.log,['BEGIN','ROLLBACK']);
  assert.deepEqual(context.get(),{freed:true,discarded:false,acquired:1});
});

test('ALT-08.10C.33 failed rollback poisons connection',async()=>{
  const context=poolFor(sql=>{if(sql==='ROLLBACK')throw Error('PG_DISCONNECT')});
  await assert.rejects(withDedicatedTenantClient(context.pool,async db=>{
    await db.query('BEGIN');return 'value';
  }),/ALT0810C33_CLEANUP_FAILED/);
  assert.deepEqual(context.get(),{freed:true,discarded:true,acquired:1});
});

test('ALT-08.10C.33 rollback failure on callback error discards client',async()=>{
  const context=poolFor(sql=>{if(sql==='ROLLBACK')throw Error('PG_DISCONNECT')});
  await assert.rejects(withDedicatedTenantClient(context.pool,async db=>{
    await db.query('BEGIN');throw Error('ORIGINAL_ERROR');
  }),/ORIGINAL_ERROR/);
  assert.deepEqual(context.get(),{freed:true,discarded:true,acquired:1});
});

test('ALT-08.10C.33 identifiers and negative catalog evidence fail closed',async()=>{
  const db={async query(){return {rows:[{
    correct_executor:true,safe_executor:true,safe_reader:true,reader_granted:true,
    force_rls:false,owner_separated:true,schema_usage:true,evidence_read:true,
    no_insert:true,no_update:true,no_delete:true,select_policy:true,no_auth_access:true,
  }],rowCount:1}}};
  const scope={schema:'isolated',table:'evidence',readerRole:'reader',executorRole:'executor'};
  await assert.rejects(preflightTenantRls(db,scope),/ALT0810C33_RLS_PREFLIGHT_DENIED/);
  await assert.rejects(preflightTenantRls(db,{...scope,table:'evidence;DROP TABLE x'}),/ALT0810C33_IDENTIFIER_DENIED/);
});
