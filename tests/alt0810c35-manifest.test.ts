import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ALT0810C35,validateC35Manifest,assertC35Baseline,
  assertC35Restored,c35CatalogDigest,C35_PREDICATE_SOURCE_SHA256,
  type C35Manifest,type C35Catalog,
} from '../lib/db/alt0810c35-operational-manifest';

const raw=JSON.parse(readFileSync(
  'schema/operational-rls/alt0810c35-disposable-manifest.json','utf8',
)) as unknown;
const manifest=validateC35Manifest(raw);
const mutate=(edit:(m:C35Manifest)=>void):unknown=>{
  const data=structuredClone(manifest);
  edit(data);return data;
};
const snapshot=():C35Catalog=>({
  relation:{schema:manifest.schema,table:manifest.table,enabled:true,forced:true,kind:'r'},
  roles:[
    {name:manifest.executorRole,login:true,superuser:false,bypassRls:false},
    {name:manifest.readerRole,login:false,superuser:false,bypassRls:false},
  ],
  member:true,setRole:true,
  columns:manifest.columns.map(x=>({...x,readerInsert:false,readerUpdate:false})),
  policies:[{name:manifest.policy.name,command:'r',permissive:true,
    roles:[manifest.readerRole],
    usingExpression:"(tenant_id = NULLIF(current_setting('app.tenant_id'::text, true), ''::text)::integer)",
    withCheck:null}],
  dependencies:manifest.dependencies.map(name=>({name,exists:true,readerAccess:false})),
  data:[{id:1,tenantId:101},{id:2,tenantId:202}],
});

test('ALT-08.10C.35 manifest is strictly pinned and ALL operational flags NO-GO',()=>{
  assert.equal(ALT0810C35.stagingEnabled,false);
  assert.equal(ALT0810C35.productionEnabled,false);
  assert.equal(ALT0810C35.operationalRlsAuthorized,false);
  assert.equal(ALT0810C35.operationalPolicyReviewed,false);
  assert.equal(ALT0810C35.migrationAuthorized,false);
  assert.equal(manifest.policy.usingSqlSha256,C35_PREDICATE_SOURCE_SHA256);
  assert.equal(manifest.reviewedOperationalPolicy,false);
  assert.equal(manifest.rollback.productionMigrationAuthorized,false);
  assert.equal(manifest.rollback.stagingMigrationAuthorized,false);
});

test('ALT-08.10C.35 any manifest drift fails before DB access',()=>{
  const bad:unknown[]=[
    mutate(m=>{m.policy.usingSql='true'}),
    mutate(m=>{m.policy.usingSqlSha256='0'.repeat(64)}),
    mutate(m=>{m.policy.roles=['PUBLIC']}),
    mutate(m=>{m.policy.permissive=false}),
    mutate(m=>{m.policy.command='ALL'}),
    mutate(m=>{m.readerRole='postgres'}),
    mutate(m=>{m.executorRole='vigia_ci'}),
    mutate(m=>{m.stagingAuthorized=true}),
    mutate(m=>{m.operationalRlsAuthorized=true}),
    mutate(m=>{m.reviewedOperationalPolicy=true}),
    mutate(m=>{m.productionAuthorized=true}),
    mutate(m=>{m.columns.push({name:'sensitive',type:'text',readerSelect:true})}),
    mutate(m=>{m.columns[2].readerSelect=true}),
    mutate(m=>{m.dependencies.splice(0,1)}),
    mutate(m=>{m.privileges.public.push('SELECT')}),
    mutate(m=>{m.privileges.readerAuth.push('SELECT')}),
    mutate(m=>{m.privileges.executorSetRole=false}),
    mutate(m=>{m.rollback.steps.splice(0,1)}),
    mutate(m=>{m.rollback.requiresNoDriftAfterRollback=false}),
    mutate(m=>{m.rollback.stagingMigrationAuthorized=true}),
    {...structuredClone(manifest),extra:true},
    null,[],{},'hi',
  ];
  for(const candidate of bad){
    assert.throws(()=>validateC35Manifest(candidate),
      /ALT0810C35_MANIFEST_DENIED/,JSON.stringify(candidate)?.slice(0,150));
  }
});

test('ALT-08.10C.35 fixture catalog requires exact minimum-privilege state',()=>{
  assert.doesNotThrow(()=>assertC35Baseline(manifest,snapshot()));
  const invalid:(keyof C35Catalog)[]=[
    'relation','roles','member','setRole','columns','policies',
    'dependencies','data',
  ];
  for(const key of invalid){
    const s=snapshot();
    if(key==='relation')s.relation.forced=false;
    if(key==='roles')s.roles[1].bypassRls=true;
    if(key==='member')s.member=false;
    if(key==='setRole')s.setRole=false;
    if(key==='columns')s.columns[2].readerSelect=true;
    if(key==='policies')s.policies[0].usingExpression='true';
    if(key==='dependencies')s.dependencies[0].readerAccess=true;
    if(key==='data')s.data[0].tenantId=202;
    assert.throws(()=>assertC35Baseline(manifest,s),
      /ALT0810C35_CATALOG_DENIED/,key);
  }
  const extra=snapshot();
  extra.policies.push({...extra.policies[0],name:'public_policy'});
  assert.throws(()=>assertC35Baseline(manifest,extra),
    /ALT0810C35_CATALOG_DENIED/);
});

test('ALT-08.10C.35 catalog digest and rollback compare full snapshots',()=>{
  const baseline=snapshot();
  const clone=structuredClone(baseline);
  assert.doesNotThrow(()=>assertC35Restored(baseline,clone));
  assert.equal(c35CatalogDigest(baseline),c35CatalogDigest(clone));
  for(const key of ['relation','roles','columns','policies','dependencies','data'] as const){
    const altered=structuredClone(baseline);
    if(key==='relation')altered.relation.forced=false;
    if(key==='roles')altered.roles[0].bypassRls=true;
    if(key==='columns')altered.columns[0].readerSelect=false;
    if(key==='policies')altered.policies[0].usingExpression='true';
    if(key==='dependencies')altered.dependencies[0].readerAccess=true;
    if(key==='data')altered.data[0].tenantId=999;
    assert.notEqual(c35CatalogDigest(baseline),c35CatalogDigest(altered));
    assert.throws(()=>assertC35Restored(baseline,altered),
      new RegExp('ALT0810C35_ROLLBACK_DRIFT:'+key));
  }
});
