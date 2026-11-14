import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ALT0810C36,validateC36Plan,readC36Catalog,
  assertC36LeastPrivilege,assertC36Restored,c36CatalogDigest,
  type C36Plan,type C36Catalog,
} from '../lib/db/alt0810c36-preoperational-audit';

const plan=validateC36Plan(JSON.parse(readFileSync(
  'schema/operational-rls/alt0810c36-prestaging-plan.json','utf8',
)) as unknown);
type Mutable<T>={-readonly [K in keyof T]:T[K]};
const corrupt=(modify:(p:Mutable<C36Plan>)=>void):unknown=>{
  const x=structuredClone(plan) as Mutable<C36Plan>;modify(x);return x;
};
const sample=():Mutable<C36Catalog>=>{
  const {evidence,readerRole,executorRole,schema,policyName}=plan.scope;
  return {
    pgMajor:16,
    roles:[{name:executorRole,login:true,superuser:false,bypassRls:false},
      {name:readerRole,login:false,superuser:false,bypassRls:false}],
    roleEdges:[{role:readerRole,member:executorRole,set:true,inherit:true,admin:false}],
    namespace:[{name:schema,owner:'vigia_ci',acl:'',publicUsage:false}],
    relations:[evidence,...plan.dependencies].sort().map(name=>({
      name,owner:'vigia_ci',kind:'r',rls:name===evidence,
      force:name===evidence,acl:'',readerSelect:name===evidence,
      readerInsert:false,readerUpdate:false,readerDelete:false,publicDml:false,
    })),
    columns:[
      ...plan.dependencies.flatMap(table=>[{table,name:'id',type:'integer',acl:'',
        readerSelect:false,readerInsert:false,readerUpdate:false,publicDml:false}]),
      ...['id','tenant_id','private_text'].map((name,i)=>({
        table:evidence,name,type:i===2?'text':'integer',acl:'',
        readerSelect:i!==2,readerInsert:false,readerUpdate:false,publicDml:false,
      })),
    ],
    policies:[{table:evidence,name:policyName,command:'r',permissive:true,
      roles:[readerRole],using:"(tenant_id = current_setting('app.tenant_id'))",
      withCheck:null}],
  };
};

test('ALT-08.10C.36 immutable no-go plan and no operational authorization',()=>{
  assert.equal(ALT0810C36.stagingEnabled,false);
  assert.equal(ALT0810C36.productionEnabled,false);
  assert.equal(ALT0810C36.operationalEnabled,false);
  assert.equal(ALT0810C36.operationalPolicyApproved,false);
  assert.equal(ALT0810C36.restoreCertified,false);
  const prohibited:unknown[]=[
    corrupt(x=>{x.stagingApproved=true}),
    corrupt(x=>{x.productionApproved=true}),
    corrupt(x=>{x.neonApproved=true}),
    corrupt(x=>{x.operationalPolicyApproved=true}),
    corrupt(x=>{x.migrationExecutionAuthorized=true}),
    corrupt(x=>{x.mergeAuthorized=true}),
    corrupt(x=>{x.physicalBackupRestoreCertified=true}),
    corrupt(x=>{x.fixtureOnly=false}),
    corrupt(x=>{x.postCommitRestoreFixtureOnly=false}),
    corrupt(x=>{x.readOnlyCatalogOnly=false}),
    corrupt(x=>{x.scope.schema='public'}),
    corrupt(x=>{x.scope.readerRole='postgres'}),
    corrupt(x=>{x.dependencies.push('other')}),
    corrupt(x=>{x.approvedPredicateSourceSha256='a'.repeat(64)}),
    corrupt(x=>{x.requiredGateEvidence.splice(0,1)}),
    {...structuredClone(plan),extra:'staging'},
    null,[],
  ];
  for(const x of prohibited)assert.throws(()=>validateC36Plan(x),
    /ALT0810C36_PLAN_DENIED/);
});

test('ALT-08.10C.36 catalog audit executes SELECT only in pg_catalog',async()=>{
  const queries:string[]=[];
  const params:unknown[][]=[];
  const db={async query(sql:string,p:unknown[]=[]){
    queries.push(sql);params.push(p);
    return {rows:sql.includes('server_version_num')?[{num:160016}]:[],rowCount:0};
  }};
  await readC36Catalog(db,plan);
  assert.equal(queries.length,7);
  for(const q of queries){
    assert.match(q.trim(),/^SELECT\b/i);
    assert.doesNotMatch(q,/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE)\s+\w+/i);
    assert.doesNotMatch(q,/FROM\s+alt0810c36_scope\./i);
  }
  assert.deepEqual(params[0],[]);
  assert.deepEqual(params[1],[plan.scope.executorRole,plan.scope.readerRole]);
  assert.deepEqual(params[4],[plan.scope.schema,
    [plan.scope.evidence,...plan.dependencies],plan.scope.readerRole]);
});

test('ALT-08.10C.36 denies every drift in roles, ACLs, policies and dependencies',()=>{
  const baseline=sample();
  assert.doesNotThrow(()=>assertC36LeastPrivilege(plan,baseline));
  const scenarios:(()=>C36Catalog)[]=[
    ()=>{const c=sample();c.pgMajor=17;return c},
    ()=>{const c=sample();c.roles[1].bypassRls=true;return c},
    ()=>{const c=sample();c.roleEdges[0].set=false;return c},
    ()=>{const c=sample();c.namespace[0].publicUsage=true;return c},
    ()=>{const c=sample();c.relations[0].publicDml=true;return c},
    ()=>{const c=sample();c.relations.find(x=>x.name==='evidence')!.force=false;return c},
    ()=>{const c=sample();c.relations.find(x=>x.name==='users')!.readerSelect=true;return c},
    ()=>{const c=sample();c.columns.find(x=>x.name==='private_text')!.readerSelect=true;return c},
    ()=>{const c=sample();c.columns[0].publicDml=true;return c},
    ()=>{const c=sample();c.policies[0].permissive=false;return c},
    ()=>{const c=sample();c.policies[0].roles=['PUBLIC'];return c},
    ()=>{const c=sample();c.policies.push({...c.policies[0],name:'bypass'});return c},
    ()=>{const c=sample();c.relations.pop();return c},
  ];
  for(const attack of scenarios){
    assert.throws(()=>assertC36LeastPrivilege(plan,attack()),
      /ALT0810C36_PREFLIGHT_DENIED/);
  }
});

test('ALT-08.10C.36 post-COMMIT snapshot must match all catalog fields exactly',()=>{
  const s=sample();const x=structuredClone(s);
  assert.equal(c36CatalogDigest(s),c36CatalogDigest(x));
  assert.doesNotThrow(()=>assertC36Restored(s,x));
  x.namespace[0].acl='=U/postgres';
  assert.throws(()=>assertC36Restored(s,x),/ALT0810C36_CATALOG_DRIFT:namespace/);
  assert.notEqual(c36CatalogDigest(s),c36CatalogDigest(x));
  const y=structuredClone(s);y.roles[0].login=false;
  assert.throws(()=>assertC36Restored(s,y),/ALT0810C36_CATALOG_DRIFT:roles/);
});
