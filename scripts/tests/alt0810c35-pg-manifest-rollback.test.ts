/**
 * ALT-08.10C.35 — PostgreSQL 16 disposable-only catalog drift and rollback.
 *
 * Destructive SQL is limited to schema/roles created inside the CI service.
 * NEVER accepts connection strings, schema names, or SQL from HTTP/users.
 * NO Neon, staging, production, migration runner, or remote DDL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {
  validateC35Manifest,assertC35Baseline,assertC35Restored,
  c35CatalogDigest,type C35Catalog,
} from '../../lib/db/alt0810c35-operational-manifest';
import {
  preflightExclusiveTenantPolicy,policyExpressionDigest,
  withDisposableScopedRead,
} from '../../lib/db/alt0810c34-policy-pool-guard';
import {
  withDedicatedTenantClient,type DedicatedPool,
} from '../../lib/db/alt0810c33-operational-contract';

const e=process.env;
if(e.CI!=='true'||e.GITHUB_ACTIONS!=='true'||e.RUNNER_OS!=='Linux'||
   e.ALT0810C35_EPHEMERAL!=='1'||e.PGHOST!=='127.0.0.1'||
   e.PGPORT!=='5432'||e.PGUSER!=='vigia_ci'||
   e.PGPASSWORD!=='isolated_ci_only'||e.PGDATABASE!=='vigia_alt081_ci'||
   e.DATABASE_URL||e.RLS_DATABASE_URL||e.NODE_ENV==='production'||
   !e.RUNNER_TEMP)throw Error('ALT0810C35_DISPOSABLE_ONLY');

const m=validateC35Manifest(JSON.parse(readFileSync(
  'schema/operational-rls/alt0810c35-disposable-manifest.json','utf8',
)) as unknown);
type Db={query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[]}>};
type Admin=Db&{connect():Promise<void>;end():Promise<void>};
type Pooled=DedicatedPool&{end():Promise<void>};
const {Client,Pool}=createRequire(import.meta.url)('pg') as {
  Client:new(o:Record<string,unknown>)=>Admin;
  Pool:new(o:Record<string,unknown>)=>Pooled;
};
const cfg={host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
  user:'vigia_ci',password:'isolated_ci_only'};
const admin=new Client(cfg);

function bool(value:unknown):boolean{return value===true||value==='t'}
function str(value:unknown):string{return String(value??'')}
async function rows(db:Db,sql:string,params:unknown[]=[]):Promise<Record<string,unknown>[]>{
  return (await db.query(sql,params)).rows;
}

/** Independent, ordered PG16 catalog snapshot; includes ACLs and actual fixture rows. */
async function catalog(db:Db):Promise<C35Catalog>{
  const relations=await rows(db,`SELECT n.nspname::text AS schema_name,
    c.relname::text AS table_name,c.relrowsecurity AS enabled,
    c.relforcerowsecurity AS forced,c.relkind::text AS kind,
    COALESCE(n.nspacl::text,'') AS schema_acl,
    COALESCE(c.relacl::text,'') AS table_acl
    FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid
    WHERE n.nspname=$1 AND c.relname=$2`,[m.schema,m.table]);
  if(relations.length!==1)throw Error('ALT0810C35_TABLE_MISSING');
  const relation=relations[0];
  const roleRows=await rows(db,`SELECT rolname::text AS name,
    rolcanlogin AS login,rolsuper AS superuser,rolbypassrls AS bypass_rls
    FROM pg_roles WHERE rolname IN ($1,$2) ORDER BY rolname`,
    [m.executorRole,m.readerRole]);
  const membership=await rows(db,`SELECT
    pg_has_role($1,$2,'MEMBER') AS member,
    pg_has_role($1,$2,'SET') AS can_set`,
    [m.executorRole,m.readerRole]);
  const roleGrants=await rows(db,`SELECT parent.rolname::text AS role_name,
    member.rolname::text AS member_name,m.set_option AS can_set,
    m.inherit_option AS can_inherit,m.admin_option AS can_admin
    FROM pg_auth_members m
    JOIN pg_roles parent ON parent.oid=m.roleid
    JOIN pg_roles member ON member.oid=m.member
    WHERE parent.rolname IN ($1,$2) OR member.rolname IN ($1,$2)
    ORDER BY parent.rolname,member.rolname`,[m.executorRole,m.readerRole]);
  const cols=await rows(db,`SELECT a.attname::text AS name,
    format_type(a.atttypid,a.atttypmod) AS type,
    has_column_privilege($1,c.oid,a.attname::text,'SELECT') AS can_select,
    has_column_privilege($1,c.oid,a.attname::text,'INSERT') AS can_insert,
    has_column_privilege($1,c.oid,a.attname::text,'UPDATE') AS can_update,
    COALESCE(a.attacl::text,'') AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname=$2 AND c.relname=$3 AND a.attnum>0 AND NOT a.attisdropped
    ORDER BY a.attnum`,[m.readerRole,m.schema,m.table]);
  const policies=await rows(db,`SELECT p.polname::text AS name,
    p.polcmd::text AS command,p.polpermissive AS permissive,
    ARRAY(SELECT r.rolname::text FROM pg_roles r
       WHERE r.oid=ANY(p.polroles) ORDER BY r.rolname) AS roles,
    pg_get_expr(p.polqual,p.polrelid) AS using_expression,
    pg_get_expr(p.polwithcheck,p.polrelid) AS with_check
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$1 AND c.relname=$2 ORDER BY p.polname`,
    [m.schema,m.table]);
  const depRows=await rows(db,`SELECT c.relname::text AS name,
    (has_any_column_privilege($1,c.oid,'SELECT') OR
     has_any_column_privilege($1,c.oid,'INSERT') OR
     has_any_column_privilege($1,c.oid,'UPDATE') OR
     has_table_privilege($1,c.oid,'DELETE')) AS reader_access
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=$2 AND c.relname::text=ANY($3::text[]) AND c.relkind='r'`,
    [m.readerRole,m.schema,m.dependencies]);
  const depMap=new Map(depRows.map(r=>[str(r.name),bool(r.reader_access)]));
  const fixtureData=await rows(db,`SELECT id,tenant_id FROM
    ${m.schema}.${m.table} ORDER BY id`);
  const publicAcls=await rows(db,`
    SELECT NOT EXISTS (
      SELECT 1 FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid
      CROSS JOIN LATERAL aclexplode(
        CASE WHEN cardinality(n.nspacl)=0 THEN NULL::aclitem[]
        ELSE COALESCE(n.nspacl,acldefault('n',n.nspowner)) END
      ) a
      WHERE n.nspname=$1 AND c.relname=$2
        AND a.grantee=0 AND a.privilege_type='USAGE'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(
        CASE WHEN cardinality(c.relacl)=0 THEN NULL::aclitem[]
        ELSE COALESCE(c.relacl,acldefault('r',c.relowner)) END
      ) a
      WHERE n.nspname=$1 AND c.relname=$2 AND a.grantee=0
        AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute col ON col.attrelid=c.oid AND col.attnum>0
        AND NOT col.attisdropped
      CROSS JOIN LATERAL aclexplode(
        CASE WHEN cardinality(col.attacl)>0 THEN col.attacl
        ELSE NULL::aclitem[] END
      ) a
      WHERE n.nspname=$1 AND c.relname=$2 AND a.grantee=0
        AND a.privilege_type IN ('SELECT','INSERT','UPDATE')
    ) AS no_public_acl`,[m.schema,m.table]);
  return {
    relation:{schema:str(relation.schema_name),table:str(relation.table_name),
      enabled:bool(relation.enabled),forced:bool(relation.forced),kind:str(relation.kind)},
    roles:roleRows.map(r=>({name:str(r.name),login:bool(r.login),
      superuser:bool(r.superuser),bypassRls:bool(r.bypass_rls)})),
    member:bool(membership[0]?.member),setRole:bool(membership[0]?.can_set),
    roleGrants:roleGrants.map(r=>({role:str(r.role_name),member:str(r.member_name),
      set:bool(r.can_set),inherit:bool(r.can_inherit),admin:bool(r.can_admin)})),
    acls:{schema:str(relation.schema_acl),table:str(relation.table_acl),
      columns:cols.map(r=>({name:str(r.name),acl:str(r.acl)})),
      noPublicAcl:bool(publicAcls[0]?.no_public_acl)},
    columns:cols.map(r=>({name:str(r.name),type:str(r.type),
      readerSelect:bool(r.can_select),readerInsert:bool(r.can_insert),
      readerUpdate:bool(r.can_update)})),
    policies:policies.map(r=>({name:str(r.name),command:str(r.command),
      permissive:bool(r.permissive),roles:Array.isArray(r.roles)?r.roles.map(str):[],
      usingExpression:str(r.using_expression),
      withCheck:r.with_check===null?null:str(r.with_check)})),
    dependencies:m.dependencies.map(name=>({name,exists:depMap.has(name),
      readerAccess:depMap.get(name)??false})),
    data:fixtureData.map(r=>({id:Number(r.id),tenantId:Number(r.tenant_id)})),
  };
}

test('ALT-08.10C.35 pinned predicate, ACL dependencies and exact rollback PG16',
  {timeout:45000},async()=>{
  await admin.connect();
  let created=false;
  let pool:Pooled|undefined;
  try{
    assert.equal((await rows(admin,'SELECT to_regnamespace($1) AS n',[m.schema]))[0].n,null);
    for(const name of [m.executorRole,m.readerRole]){
      assert.equal((await rows(admin,'SELECT rolname FROM pg_roles WHERE rolname=$1',[name])).length,0);
    }
    created=true;
    await admin.query(`CREATE ROLE ${m.readerRole}
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await admin.query(`CREATE ROLE ${m.executorRole} LOGIN PASSWORD 'ci35_executor_only'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`);
    await admin.query(`CREATE SCHEMA ${m.schema}`);
    for(const dep of m.dependencies) await admin.query(
      `CREATE TABLE ${m.schema}.${dep} (id integer)`);
    await admin.query(`CREATE TABLE ${m.schema}.${m.table}
      (id integer,tenant_id integer,private_text text)`);
    await admin.query(`INSERT INTO ${m.schema}.${m.table}
      VALUES (1,101,'synthetic-A'),(2,202,'synthetic-B')`);
    await admin.query(`GRANT ${m.readerRole} TO ${m.executorRole}`);
    await admin.query(`GRANT USAGE ON SCHEMA ${m.schema}
      TO ${m.readerRole},${m.executorRole}`);
    await admin.query(`GRANT SELECT (id,tenant_id)
      ON ${m.schema}.${m.table} TO ${m.readerRole}`);
    await admin.query(`ALTER TABLE ${m.schema}.${m.table} ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE ${m.schema}.${m.table} FORCE ROW LEVEL SECURITY`);
    await admin.query(`CREATE POLICY ${m.policy.name} ON ${m.schema}.${m.table}
      AS PERMISSIVE FOR SELECT TO ${m.readerRole}
      USING (${m.policy.usingSql})`);

    const original=await catalog(admin);
    assertC35Baseline(m,original);
    const sha=c35CatalogDigest(original);
    // Fingerprint the deparsed fixture policy only AFTER deploying pinned SQL.
    // It remains CI-only, never a substitute for an independently reviewed
    // operational predicate manifest.
    const expectedUsingSha256=policyExpressionDigest(
      original.policies[0].usingExpression);
    pool=new Pool({...cfg,user:m.executorRole,password:'ci35_executor_only',
      max:2,connectionTimeoutMillis:1500,idleTimeoutMillis:1000});
    const p=pool;
    await withDedicatedTenantClient(p,db=>preflightExclusiveTenantPolicy(db,{
      schema:m.schema,table:m.table,readerRole:m.readerRole,
      executorRole:m.executorRole,expectedPolicyName:m.policy.name,
      expectedUsingSha256,
    }));
    for(const [tenantId,expected] of [[101,[1]],[202,[2]]] as const){
      const ids=await withDisposableScopedRead(p,{tenantId,readerRole:m.readerRole},
        async db=>(await db.query(
          `SELECT id FROM ${m.schema}.${m.table} ORDER BY id`
        )).rows.map(x=>Number(x.id)));
      assert.deepEqual(ids,expected);
    }
    await assert.rejects(
      withDisposableScopedRead(p,{tenantId:101,readerRole:m.readerRole},
        async db=>db.query(`SELECT private_text FROM ${m.schema}.${m.table}`)),
      /permission denied/i);
    const alterations=[
      {name:'predicate-using-true',sql:`ALTER POLICY ${m.policy.name}
        ON ${m.schema}.${m.table} USING(true)`},
      {name:'extra-public-policy',sql:`CREATE POLICY c35_public
        ON ${m.schema}.${m.table} FOR SELECT TO PUBLIC USING(true)`},
      {name:'force-rls-off',sql:`ALTER TABLE ${m.schema}.${m.table}
        NO FORCE ROW LEVEL SECURITY`},
      {name:'public-select',sql:`GRANT SELECT
        ON ${m.schema}.${m.table} TO PUBLIC`},
      {name:'public-column',sql:`GRANT SELECT(private_text)
        ON ${m.schema}.${m.table} TO PUBLIC`},
      {name:'reader-sensitive-column',sql:`GRANT SELECT(private_text)
        ON ${m.schema}.${m.table} TO ${m.readerRole}`},
      {name:'public-schema-usage',sql:`GRANT USAGE
        ON SCHEMA ${m.schema} TO PUBLIC`},
      {name:'auth-dependency-grant',sql:`GRANT SELECT
        ON ${m.schema}.users TO ${m.readerRole}`},
      {name:'role-set-revoked',sql:`GRANT ${m.readerRole}
        TO ${m.executorRole} WITH SET FALSE`},
      {name:'reader-bypassrls',sql:`ALTER ROLE ${m.readerRole} BYPASSRLS`},
      {name:'lost-dependency',sql:`DROP TABLE ${m.schema}.memberships`},
      {name:'tenant-data-drift',sql:`UPDATE ${m.schema}.${m.table}
        SET tenant_id=202 WHERE id=1`},
    ];
    for(const mutation of alterations){
      await admin.query('BEGIN');
      try{
        await admin.query('SAVEPOINT c35_drift');
        await admin.query(mutation.sql);
        const changed=await catalog(admin);
        assert.notEqual(c35CatalogDigest(changed),sha,mutation.name);
        assert.throws(()=>assertC35Restored(original,changed),
          /ALT0810C35_ROLLBACK_DRIFT/,mutation.name);
        // Must NOT accept a weakened catalog simply by modifying a flag.
        await admin.query('ROLLBACK TO SAVEPOINT c35_drift');
        const restored=await catalog(admin);
        assertC35Baseline(m,restored);
        assertC35Restored(original,restored);
        assert.equal(c35CatalogDigest(restored),sha,mutation.name);
      }finally{await admin.query('ROLLBACK')}
      assertC35Restored(original,await catalog(admin));
    }
    console.log('ALT0810C35 PG16: manifest v1, 12 adversarial drifts and full rollback snapshots GREEN',
      {catalogSha256:sha,policyExpressionSha256:expectedUsingSha256,
       disposableOnly:true,operationalCertified:false});
  }finally{
    await pool?.end().catch(()=>{});
    if(created){
      await admin.query(`DROP SCHEMA IF EXISTS ${m.schema} CASCADE`).catch(()=>{});
      await admin.query(`REVOKE ${m.readerRole} FROM ${m.executorRole}`).catch(()=>{});
      await admin.query(`DROP ROLE IF EXISTS ${m.executorRole}`).catch(()=>{});
      await admin.query(`DROP ROLE IF EXISTS ${m.readerRole}`).catch(()=>{});
    }
    await admin.end();
  }
});
