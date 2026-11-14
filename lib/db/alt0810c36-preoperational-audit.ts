/**
 * ALT-08.10C.36 — PostgreSQL 16 catalog-only pre-staging audit.
 * No operational connection, migration, table DML, or production opt-in.\n * ACLs normalize their effective grantee/grantor/privilege/grant-option; raw\n * pg_acl textual storage can differ after GRANT+REVOKE without privilege drift.
 *
 * A catalog snapshot is evidence of configuration, NOT approval of its
 * semantic security or the ability to restore a real post-COMMIT database.
 */
import {createHash} from 'node:crypto';
import {C35_PREDICATE_SOURCE_SHA256} from './alt0810c35-operational-manifest';

export const ALT0810C36=Object.freeze({
  id:'alt0810c36-prestaging-disposable-v1',
  operationalEnabled:false,stagingEnabled:false,productionEnabled:false,
  operationalPolicyApproved:false,restoreCertified:false,
});

export type C36Plan=Readonly<{
  id:string;version:number;postgresMajor:number;
  scope:{schema:string;evidence:string;readerRole:string;executorRole:string;policyName:string};
  dependencies:string[];approvedPredicateSourceSha256:string;
  fixtureOnly:boolean;readOnlyCatalogOnly:boolean;
  postCommitRestoreFixtureOnly:boolean;stagingApproved:boolean;
  neonApproved:boolean;productionApproved:boolean;
  operationalPolicyApproved:boolean;physicalBackupRestoreCertified:boolean;
  migrationExecutionAuthorized:boolean;mergeAuthorized:boolean;
  requiredGateEvidence:string[];
}>;
export type PgCatalogQuery={
  query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount:number|null}>;
};
export type C36Catalog=Readonly<{
  pgMajor:number;
  roles:{name:string;login:boolean;superuser:boolean;bypassRls:boolean}[];
  roleEdges:{role:string;member:string;set:boolean;inherit:boolean;admin:boolean}[];
  namespace:{name:string;owner:string;acl:string;publicUsage:boolean}[];
  relations:{name:string;owner:string;kind:string;rls:boolean;force:boolean;
    acl:string;readerSelect:boolean;readerInsert:boolean;readerUpdate:boolean;
    readerDelete:boolean;publicDml:boolean}[];
  columns:{table:string;name:string;type:string;acl:string;readerSelect:boolean;
    readerInsert:boolean;readerUpdate:boolean;publicDml:boolean}[];
  policies:{table:string;name:string;command:string;permissive:boolean;
    roles:string[];using:string|null;withCheck:string|null}[];
}>;

const fixedScope={schema:'alt0810c36_scope',evidence:'evidence',
  readerRole:'alt0810c36_reader',executorRole:'alt0810c36_executor',
  policyName:'c36_tenant_select'};
const fixedDeps=['users','memberships','tenants','subscriptions',
  'tenant_features','plan_features'];
const fixedEvidence=['preflight-read-only-transaction','baseline-catalog-digest',
  'postcommit-drift-detected','failed-compensation-rolled-back',
  'compensating-commit','catalog-and-data-restored','six-ci-jobs-green'];
const isRecord=(x:unknown):x is Record<string,unknown>=>x!==null&&
  typeof x==='object'&&!Array.isArray(x);
const equal=(a:unknown,b:unknown):boolean=>JSON.stringify(a)===JSON.stringify(b);
function keys(x:unknown,list:string[]):boolean{
  return isRecord(x)&&equal(Object.keys(x).sort(),[...list].sort());
}
function denied():never{throw Error('ALT0810C36_PLAN_DENIED')}
export function validateC36Plan(raw:unknown):C36Plan{
  if(!keys(raw,['id','version','postgresMajor','scope','dependencies',
      'approvedPredicateSourceSha256','fixtureOnly','readOnlyCatalogOnly',
      'postCommitRestoreFixtureOnly','stagingApproved','neonApproved',
      'productionApproved','operationalPolicyApproved',
      'physicalBackupRestoreCertified','migrationExecutionAuthorized',
      'mergeAuthorized','requiredGateEvidence']))denied();
  const p=raw as C36Plan;
  if(!keys(p.scope,Object.keys(fixedScope))||
     !equal(p.scope,fixedScope)||!equal(p.dependencies,fixedDeps)||
     !equal(p.requiredGateEvidence,fixedEvidence)||
     p.id!==ALT0810C36.id||p.version!==1||p.postgresMajor!==16||
     p.approvedPredicateSourceSha256!==C35_PREDICATE_SOURCE_SHA256||
     p.fixtureOnly!==true||p.readOnlyCatalogOnly!==true||
     p.postCommitRestoreFixtureOnly!==true||p.stagingApproved!==false||
     p.neonApproved!==false||p.productionApproved!==false||
     p.operationalPolicyApproved!==false||
     p.physicalBackupRestoreCertified!==false||
     p.migrationExecutionAuthorized!==false||p.mergeAuthorized!==false)denied();
  return p;
}
const str=(x:unknown)=>String(x??'');
const bit=(x:unknown)=>x===true||x==='t';
const rows=async(db:PgCatalogQuery,sql:string,params:unknown[]=[])=>
  (await db.query(sql,params)).rows;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const c36CatalogDigest=(value:C36Catalog):string=>hash(value);
export function assertC36Restored(before:C36Catalog,after:C36Catalog):void{
  if(!equal(before,after)){
    const changed=(Object.keys(before) as (keyof C36Catalog)[]).
      filter(k=>!equal(before[k],after[k]));
    throw Error('ALT0810C36_CATALOG_DRIFT:'+changed.join(','));
  }
}
/**
 * SQL issued here is SELECT from pg_catalog only; every selected schema/role
 * is pinned by validateC36Plan, and all filters are bind parameters.
 * The invoker must begin READ ONLY on its dedicated CI fixture connection.
 * Never accept plans from the HTTP layer.
 */
export async function readC36Catalog(
  db:PgCatalogQuery,plan:C36Plan,
):Promise<C36Catalog>{
  validateC36Plan(plan);
  const {schema,evidence,readerRole,executorRole}=plan.scope;
  const tables=[evidence,...plan.dependencies];
  const v=await rows(db,"SELECT current_setting('server_version_num')::integer AS num");
  const roleRows=await rows(db,`SELECT rolname::text AS name,rolcanlogin AS login,
    rolsuper AS superuser,rolbypassrls AS bypass_rls
    FROM pg_roles WHERE rolname IN ($1,$2) ORDER BY rolname`,
    [executorRole,readerRole]);
  const edges=await rows(db,`SELECT parent.rolname::text AS role_name,
    member.rolname::text AS member_name,m.set_option AS set_option,
    m.inherit_option AS inherit_option,m.admin_option AS admin_option
    FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid
    JOIN pg_roles member ON member.oid=m.member
    WHERE parent.rolname IN ($1,$2) OR member.rolname IN ($1,$2)
    ORDER BY parent.rolname,member.rolname`,[executorRole,readerRole]);
  const ns=await rows(db,`SELECT n.nspname::text AS name,
    pg_get_userbyid(n.nspowner) AS owner,
    COALESCE((
      SELECT string_agg(format('%s:%s:%s:%s',
        g.grantee,g.grantor,g.privilege_type,g.is_grantable),
        ',' ORDER BY g.grantee,g.grantor,g.privilege_type,g.is_grantable)
      FROM aclexplode(CASE WHEN cardinality(n.nspacl)=0 THEN NULL::aclitem[] ELSE COALESCE(n.nspacl,acldefault('n',n.nspowner)) END) g
    ),'') AS acl,
    EXISTS(SELECT 1 FROM aclexplode(
      CASE WHEN cardinality(n.nspacl)=0 THEN NULL::aclitem[]
        ELSE COALESCE(n.nspacl,acldefault('n',n.nspowner)) END
    ) acl WHERE acl.grantee=0 AND acl.privilege_type='USAGE') AS public_usage
    FROM pg_namespace n WHERE n.nspname=$1`,[schema]);
  const rel=await rows(db,`SELECT c.relname::text AS name,
    pg_get_userbyid(c.relowner) AS owner,c.relkind::text AS kind,
    c.relrowsecurity AS rls,c.relforcerowsecurity AS force,
    COALESCE((
      SELECT string_agg(format('%s:%s:%s:%s',
        g.grantee,g.grantor,g.privilege_type,g.is_grantable),
        ',' ORDER BY g.grantee,g.grantor,g.privilege_type,g.is_grantable)
      FROM aclexplode(CASE WHEN cardinality(c.relacl)=0 THEN NULL::aclitem[] ELSE COALESCE(c.relacl,acldefault('r',c.relowner)) END) g
    ),'') AS acl,
    has_any_column_privilege($3,c.oid,'SELECT') AS reader_select,
    has_any_column_privilege($3,c.oid,'INSERT') AS reader_insert,
    has_any_column_privilege($3,c.oid,'UPDATE') AS reader_update,
    has_table_privilege($3,c.oid,'DELETE') AS reader_delete,
    EXISTS(SELECT 1 FROM aclexplode(
      CASE WHEN cardinality(c.relacl)=0 THEN NULL::aclitem[]
        ELSE COALESCE(c.relacl,acldefault('r',c.relowner)) END
      ) acl WHERE acl.grantee=0 AND
      acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) AS public_dml
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname::text=ANY($2::text[])
      AND c.relkind IN ('r','p') ORDER BY c.relname`,
    [schema,tables,readerRole]);
  const columns=await rows(db,`SELECT c.relname::text AS table_name,
    a.attname::text AS name,format_type(a.atttypid,a.atttypmod) AS type,
    COALESCE((
      SELECT string_agg(format('%s:%s:%s:%s',
        g.grantee,g.grantor,g.privilege_type,g.is_grantable),
        ',' ORDER BY g.grantee,g.grantor,g.privilege_type,g.is_grantable)
      FROM aclexplode(CASE WHEN cardinality(a.attacl)>0 THEN a.attacl ELSE NULL::aclitem[] END) g
    ),'') AS acl,
    has_column_privilege($3,c.oid,a.attname::text,'SELECT') AS reader_select,
    has_column_privilege($3,c.oid,a.attname::text,'INSERT') AS reader_insert,
    has_column_privilege($3,c.oid,a.attname::text,'UPDATE') AS reader_update,
    EXISTS(SELECT 1 FROM aclexplode(
      CASE WHEN cardinality(a.attacl)>0 THEN a.attacl ELSE NULL::aclitem[] END
    ) acl WHERE acl.grantee=0 AND
      acl.privilege_type IN ('SELECT','INSERT','UPDATE')) AS public_dml
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname=$1 AND c.relname::text=ANY($2::text[])
    ORDER BY c.relname,a.attnum`,[schema,tables,readerRole]);
  const policies=await rows(db,`SELECT c.relname::text AS table_name,
    p.polname::text AS name,p.polcmd::text AS command,
    p.polpermissive AS permissive,
    ARRAY(SELECT COALESCE(r.rolname::text,'PUBLIC') FROM
      unnest(p.polroles) ids(oid) LEFT JOIN pg_roles r ON r.oid=ids.oid
      ORDER BY COALESCE(r.rolname::text,'PUBLIC')) AS roles,
    pg_get_expr(p.polqual,p.polrelid) AS using_expression,
    pg_get_expr(p.polwithcheck,p.polrelid) AS with_check
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname::text=ANY($2::text[])
    ORDER BY c.relname,p.polname`,[schema,tables]);
  return {
    pgMajor:Math.floor(Number(v[0]?.num)/10000),
    roles:roleRows.map(x=>({name:str(x.name),login:bit(x.login),
      superuser:bit(x.superuser),bypassRls:bit(x.bypass_rls)})),
    roleEdges:edges.map(x=>({role:str(x.role_name),member:str(x.member_name),
      set:bit(x.set_option),inherit:bit(x.inherit_option),
      admin:bit(x.admin_option)})),
    namespace:ns.map(x=>({name:str(x.name),owner:str(x.owner),acl:str(x.acl),
      publicUsage:bit(x.public_usage)})),
    relations:rel.map(x=>({name:str(x.name),owner:str(x.owner),kind:str(x.kind),
      rls:bit(x.rls),force:bit(x.force),acl:str(x.acl),
      readerSelect:bit(x.reader_select),readerInsert:bit(x.reader_insert),
      readerUpdate:bit(x.reader_update),readerDelete:bit(x.reader_delete),
      publicDml:bit(x.public_dml)})),
    columns:columns.map(x=>({table:str(x.table_name),name:str(x.name),
      type:str(x.type),acl:str(x.acl),readerSelect:bit(x.reader_select),
      readerInsert:bit(x.reader_insert),readerUpdate:bit(x.reader_update),
      publicDml:bit(x.public_dml)})),
    policies:policies.map(x=>({table:str(x.table_name),name:str(x.name),
      command:str(x.command),permissive:bit(x.permissive),
      roles:Array.isArray(x.roles)?x.roles.map(str):[],
      using:x.using_expression===null?null:str(x.using_expression),
      withCheck:x.with_check===null?null:str(x.with_check)})),
  };
}
/** Denies an unexpected table/column/role/policy or any enlarged privilege. */
export function assertC36LeastPrivilege(plan:C36Plan,s:C36Catalog):void{
  validateC36Plan(plan);
  const no=():never=>{throw Error('ALT0810C36_PREFLIGHT_DENIED')};
  const {schema,evidence,readerRole,executorRole,policyName}=plan.scope;
  if(s.pgMajor!==16||s.namespace.length!==1||
    s.namespace[0].name!==schema||s.namespace[0].publicUsage||
    !equal(s.roles,[
      {name:executorRole,login:true,superuser:false,bypassRls:false},
      {name:readerRole,login:false,superuser:false,bypassRls:false},
    ])||
    !equal(s.roleEdges,[{role:readerRole,member:executorRole,
      set:true,inherit:true,admin:false}]))no();
  const names=[evidence,...plan.dependencies].sort();
  if(!equal(s.relations.map(r=>r.name),names))no();
  for(const r of s.relations){
    if(r.kind!=='r'||r.publicDml||r.readerInsert||r.readerUpdate||
       r.readerDelete)no();
    if(r.name===evidence){
      if(!r.rls||!r.force||!r.readerSelect)no();
    }else if(r.rls||r.force||r.readerSelect)no();
  }
  const evidenceColumns=s.columns.filter(c=>c.table===evidence);
  if(!equal(evidenceColumns.map(c=>({
    name:c.name,type:c.type,select:c.readerSelect,
  })),[
    {name:'id',type:'integer',select:true},
    {name:'tenant_id',type:'integer',select:true},
    {name:'private_text',type:'text',select:false},
  ]))no();
  for(const c of s.columns){
    if(c.publicDml||c.readerInsert||c.readerUpdate||
      (c.table!==evidence&&c.readerSelect))no();
  }
  if(s.policies.length!==1||
    !equal(s.policies.map(p=>({
      table:p.table,name:p.name,command:p.command,
      permissive:p.permissive,roles:p.roles,withCheck:p.withCheck,
    })),[{
      table:evidence,name:policyName,command:'r',
      permissive:true,roles:[readerRole],withCheck:null,
    }]))no();
  // Deparsed expression checked against pinned SQL by C.34 in the PG test;
  // the presence of token strings alone is not a standalone security proof.
  const predicate=s.policies[0].using;
  if(!predicate||!predicate.includes('app.tenant_id')||
    !predicate.includes('tenant_id'))no();
}
