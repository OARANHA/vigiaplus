import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALT086_ROLE_MATRIX,ALT086_RUNTIME_GATE,assertAlt086PreproductionOnly,
  requireAlt086ClientReadContext,
} from '../lib/tenant/rls-preproduction-gate';
import type {TenantContext} from '../lib/tenant/context';
import {withAuthenticatedClientRls} from '../lib/tenant/rls-runtime';
import type {TenantSqlPool} from '../lib/tenant/rls-transaction';

function context(role:TenantContext['role'],overrides:Partial<TenantContext>={}):TenantContext{
  return {userId:701,userName:'synthetic',role,tenantId:7,system:false,
    surface:'app',density:'basico',vocabulary:'leigo',ip:null,
    requestId:'alt086-contract',...overrides};
}
test('ALT-08.6: roles internos e de serviço permanecem NO-GO; clientes somente leitura',()=>{
  assert.equal(ALT086_ROLE_MATRIX.owner.read,false);
  assert.equal(ALT086_ROLE_MATRIX.analyst.read,false);
  assert.equal(ALT086_ROLE_MATRIX.worker.read,false);
  assert.equal(ALT086_ROLE_MATRIX.webhook.read,false);
  for(const role of ['client_admin','client_viewer'] as const){
    assert.equal(requireAlt086ClientReadContext(context(role)),7);
    assert.equal(ALT086_ROLE_MATRIX[role].write,false);
  }
  for(const role of ['owner','analyst'] as const){
    assert.throws(()=>requireAlt086ClientReadContext(context(role)),/ALT086_ROLE_NOT_HOMOLOGATED/);
  }
  assert.throws(()=>requireAlt086ClientReadContext(context('client_admin',{system:true})),
    /RLS_CLIENT_CONTEXT_REQUIRED/);
  assert.throws(()=>requireAlt086ClientReadContext(context('client_viewer',{tenantId:null})),
    /RLS_TENANT_SCOPE_REQUIRED/);
  assert.throws(()=>requireAlt086ClientReadContext(context('client_admin',{surface:'console'})),
    /RLS_CLIENT_CONTEXT_REQUIRED/);
  assert.equal(ALT086_RUNTIME_GATE.productionAllowed,false);
  assert.equal(ALT086_RUNTIME_GATE.operationalDriverIntegrated,false);
});
test('ALT-08.6: preflight exige banco local efêmero, bloqueia production/Neon',()=>{
  const safe={CI:'true',GITHUB_ACTIONS:'true',ALT086_EPHEMERAL_POSTGRES:'1',
    PGHOST:'127.0.0.1',PGDATABASE:'vigia_alt081_ci',PGUSER:'vigia_ci',
    DATABASE_URL:'',RLS_DATABASE_URL:'',NODE_ENV:'test'};
  assert.doesNotThrow(()=>assertAlt086PreproductionOnly(safe));
  for(const change of [
    {DATABASE_URL:'postgresql://production'},
    {RLS_DATABASE_URL:'postgresql://remote'},
    {NODE_ENV:'production'},
    {CI:'false'},
    {PGHOST:'10.0.0.5'},
    {PGDATABASE:'vigia_operational'},
    {ALT086_EPHEMERAL_POSTGRES:'0'},
  ]){
    assert.throws(()=>assertAlt086PreproductionOnly({...safe,...change}),
      /ALT086_PREPRODUCTION_CI_ONLY/);
  }
});
test('ALT-08.6: autorização rejeita contextos não-clientes antes de abrir conexão',async()=>{
  let connects=0;
  const pool:TenantSqlPool={connect:async()=>{connects++;throw Error('connection not allowed')}};
  for(const ctx of [context('owner'),context('analyst'),
    context('client_admin',{system:true}),context('client_viewer',{tenantId:null})]){
    await assert.rejects(withAuthenticatedClientRls(ctx,pool,async()=>[]));
  }
  assert.equal(connects,0);
});
