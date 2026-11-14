/**
 * ALT-08.10C.35 — audit of a pinned PostgreSQL 16 DISPOSABLE policy fixture.
 *
 * This contract is never connected to getDb(), routes, staging, or Neon.
 * A fixture SQL SHA is NOT an independently reviewed operational policy.
 * A rollback that disables RLS without reverting the database policy state
 * is not safe, even when ALT0810C32_MODE=off.
 */
import {createHash} from 'node:crypto';

export const ALT0810C35=Object.freeze({
  version:'alt0810c35-disposable-manifest-and-rollback-v1',
  stagingEnabled:false,productionEnabled:false,
  operationalRlsAuthorized:false,
  operationalPolicyReviewed:false,
  migrationAuthorized:false,
});

export const C35_PREDICATE_SOURCE_SHA256=
  '778e1a77b79ef32bc24281ce6561dafb57584da2772c184a5aaadf2973f93dfe';

export type C35Manifest={
  id:string;version:number;postgresMajor:number;target:string;
  stagingAuthorized:boolean;productionAuthorized:boolean;
  operationalRlsAuthorized:boolean;reviewedOperationalPolicy:boolean;
  schema:string;table:string;executorRole:string;readerRole:string;
  policy:{name:string;command:string;permissive:boolean;roles:string[];
    usingSql:string;usingSqlSha256:string};
  columns:{name:string;type:string;readerSelect:boolean}[];
  dependencies:string[];
  privileges:{readerSchema:string[];readerTable:string[];
    readerDml:string[];readerAuth:string[];public:string[];executorSetRole:boolean};
  rollback:{requiresCatalogSnapshot:boolean;requiresNoDriftAfterRollback:boolean;
    steps:string[];stagingMigrationAuthorized:boolean;productionMigrationAuthorized:boolean};
};

export type C35Catalog={
  relation:{schema:string;table:string;enabled:boolean;forced:boolean;kind:string};
  roles:{name:string;login:boolean;superuser:boolean;bypassRls:boolean}[];
  member:boolean;setRole:boolean;
  columns:{name:string;type:string;readerSelect:boolean;
    readerInsert:boolean;readerUpdate:boolean}[];
  policies:{name:string;command:string;permissive:boolean;
    roles:string[];usingExpression:string;withCheck:string|null}[];
  dependencies:{name:string;exists:boolean;readerAccess:boolean}[];
  data:{id:number;tenantId:number}[];
};

export function sha256(text:string):string{
  return createHash('sha256').update(text,'utf8').digest('hex');
}
function record(x:unknown):x is Record<string,unknown>{
  return x!==null&&typeof x==='object'&&!Array.isArray(x);
}
function keys(x:unknown,expected:string[]):boolean{
  return record(x) && JSON.stringify(Object.keys(x).sort())===
    JSON.stringify([...expected].sort());
}
function exactly(x:unknown,expected:unknown):boolean{
  return JSON.stringify(x)===JSON.stringify(expected);
}
function deny():never{throw Error('ALT0810C35_MANIFEST_DENIED')}

/**
 * Strict shape + pinned fields. Altering any role, grant, SQL predicate or
 * approval flag is a review-required code change, never an env opt-in.
 */
export function validateC35Manifest(raw:unknown):C35Manifest{
  if(!keys(raw,['id','version','postgresMajor','target','stagingAuthorized',
    'productionAuthorized','operationalRlsAuthorized','reviewedOperationalPolicy',
    'schema','table','executorRole','readerRole','policy','columns',
    'dependencies','privileges','rollback'])) deny();
  const m=raw as C35Manifest;
  if(m.id!=='alt0810c35-pg16-disposable-v1'||m.version!==1||
     m.postgresMajor!==16||m.target!=='disposable-github-actions-only'||
     m.stagingAuthorized!==false||m.productionAuthorized!==false||
     m.operationalRlsAuthorized!==false||m.reviewedOperationalPolicy!==false||
     m.schema!=='alt0810c35_scope'||m.table!=='evidence'||
     m.executorRole!=='alt0810c35_executor'||m.readerRole!=='alt0810c35_reader') deny();
  if(!keys(m.policy,['name','command','permissive','roles','usingSql','usingSqlSha256'])||
     m.policy.name!=='c35_tenant_select'||m.policy.command!=='SELECT'||
     m.policy.permissive!==true||
     !exactly(m.policy.roles,['alt0810c35_reader'])||
     m.policy.usingSql!=="tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer"||
     m.policy.usingSqlSha256!==C35_PREDICATE_SOURCE_SHA256||
     sha256(m.policy.usingSql)!==C35_PREDICATE_SOURCE_SHA256) deny();
  const expectedColumns=[
    {name:'id',type:'integer',readerSelect:true},
    {name:'tenant_id',type:'integer',readerSelect:true},
    {name:'private_text',type:'text',readerSelect:false},
  ];
  if(!Array.isArray(m.columns)||!m.columns.every(x=>keys(x,
     ['name','type','readerSelect']))||!exactly(m.columns,expectedColumns)) deny();
  if(!exactly(m.dependencies,
     ['users','memberships','tenants','subscriptions','tenant_features','plan_features'])) deny();
  if(!keys(m.privileges,['readerSchema','readerTable','readerDml','readerAuth',
     'public','executorSetRole'])||
     !exactly(m.privileges,{
      readerSchema:['USAGE'],readerTable:['SELECT_COLUMNS_ONLY'],
      readerDml:[],readerAuth:[],public:[],executorSetRole:true,
     })) deny();
  if(!keys(m.rollback,['requiresCatalogSnapshot','requiresNoDriftAfterRollback',
    'steps','stagingMigrationAuthorized','productionMigrationAuthorized'])||
     !exactly(m.rollback,{
       requiresCatalogSnapshot:true,requiresNoDriftAfterRollback:true,
       steps:['disable-route','drain-pool','rollback-policy','restore-force-rls',
       'restore-acl','restore-roles','restore-schema-and-data','verify-catalog'],
       stagingMigrationAuthorized:false,productionMigrationAuthorized:false,
     })) deny();
  return m;
}

/**
 * Establishes the allowed PG16 fixture catalog. This is not a proof that a
 * policy expression is safe in a real schema; the canonical policy is created
 * from the separately pinned SQL before this verifier is called.
 */
export function assertC35Baseline(m:C35Manifest,c:C35Catalog):void{
  const expect=(ok:boolean)=>{if(!ok)throw Error('ALT0810C35_CATALOG_DENIED')};
  expect(c.relation.schema===m.schema&&c.relation.table===m.table&&
     c.relation.enabled&&c.relation.forced&&c.relation.kind==='r');
  expect(exactly(c.roles,[
    {name:m.executorRole,login:true,superuser:false,bypassRls:false},
    {name:m.readerRole,login:false,superuser:false,bypassRls:false},
  ]));
  expect(c.member===true&&c.setRole===true);
  expect(exactly(c.columns,m.columns.map(x=>({
    name:x.name,type:x.type,readerSelect:x.readerSelect,
    readerInsert:false,readerUpdate:false,
  }))));
  expect(c.policies.length===1&&c.policies[0].name===m.policy.name&&
    c.policies[0].command==='r'&&c.policies[0].permissive===true&&
    exactly(c.policies[0].roles,m.policy.roles)&&
    c.policies[0].withCheck===null&&
    typeof c.policies[0].usingExpression==='string'&&
    c.policies[0].usingExpression.includes('app.tenant_id')&&
    c.policies[0].usingExpression.includes('tenant_id'));
  expect(exactly(c.dependencies,m.dependencies.map(name=>({
    name,exists:true,readerAccess:false,
  }))));
  expect(exactly(c.data,[{id:1,tenantId:101},{id:2,tenantId:202}]));
}

/**
 * The baseline is captured BEFORE mutating the fixture. Exact JSON equality
 * covers policy text, role ACLs, memberships, columns, dependencies and data.
 * It must never be manufactured from the post-mutation target catalog.
 */
export function assertC35Restored(before:C35Catalog,after:C35Catalog):void{
  if(!exactly(before,after)) {
    const areas=(Object.keys(before) as (keyof C35Catalog)[]).filter(
      key=>!exactly(before[key],after[key]),
    );
    throw Error('ALT0810C35_ROLLBACK_DRIFT:'+areas.join(','));
  }
}

export function c35CatalogDigest(c:C35Catalog):string{
  return sha256(JSON.stringify(c));
}
