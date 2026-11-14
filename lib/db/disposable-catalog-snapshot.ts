/**
 * ALT-08.10C.6 — catalog snapshot for disposable PostgreSQL rehearsal only.
 *
 * This module only SELECTs pg_catalog and information_schema. It is NOT a
 * database backup, a migration plan or a generic disaster-recovery utility.
 * Read scopes are explicit; no raw SQL identifiers from user input.
 */
export type CatalogQuery={query(sql:string,params?:unknown[]):Promise<{rows:Record<string,unknown>[]}>};
export type CatalogSnapshot={
  schema:string;
  namespaces:string[];
  relations:string[];
  columns:string[];
  constraints:string[];
  indexes:string[];
  policies:string[];
  relationGrants:string[];
  columnGrants:string[];
  schemaGrants:string[];
  roles:string[];
  memberships:string[];
};
const safeName=/^[a-z][a-z0-9_]{0,62}$/;
const stable=(rows:Record<string,unknown>[]):string[]=>rows.map(row=>JSON.stringify(row)).sort();
export async function snapshotDisposableCatalog(db:CatalogQuery,schema:string,roleNames:readonly string[]):Promise<CatalogSnapshot>{
  if(!safeName.test(schema)||!/^alt0810c6_[a-z0-9_]+$/.test(schema)||
     roleNames.length===0||roleNames.some(r=>!safeName.test(r)||!r.startsWith('alt0810c6_'))||
     new Set(roleNames).size!==roleNames.length)
    throw Error('ALT0810C6_SNAPSHOT_SCOPE_DENIED');
  const collect=async(query:string,params:unknown[])=>stable((await db.query(query,params)).rows);
  const params=[schema];
  const namespaces=await collect(`SELECT n.nspname,n.nspowner::regrole::text AS owner,
     n.nspacl::text AS acl
     FROM pg_namespace n WHERE n.nspname=$1`,params);
  const relations=await collect(`SELECT c.relname,c.relkind,c.relowner::regrole::text AS owner,
     c.relacl::text AS acl,c.relrowsecurity,c.relforcerowsecurity,
     c.relpersistence,c.reltablespace
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 ORDER BY c.relname`,params);
  const columns=await collect(`SELECT c.relname,a.attname,a.atttypid::regtype::text AS type,
     a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text AS acl,
     pg_get_expr(d.adbin,d.adrelid) AS default_expr
     FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     WHERE n.nspname=$1 AND a.attnum>0 AND NOT a.attisdropped
     ORDER BY c.relname,a.attnum`,params);
  const constraints=await collect(`SELECT c.relname,co.conname,co.contype,
     pg_get_constraintdef(co.oid,true) AS definition,co.convalidated
     FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1
     ORDER BY c.relname,co.conname`,params);
  const indexes=await collect(`SELECT t.relname AS table_name,i.relname AS index_name,
     pg_get_indexdef(ix.indexrelid) AS definition,ix.indisvalid,ix.indisunique
     FROM pg_index ix JOIN pg_class t ON t.oid=ix.indrelid
     JOIN pg_class i ON i.oid=ix.indexrelid JOIN pg_namespace n ON n.oid=t.relnamespace
     WHERE n.nspname=$1 ORDER BY t.relname,i.relname`,params);
  const policies=await collect(`SELECT p.tablename,p.policyname,p.permissive,p.roles,
     p.cmd,p.qual,p.with_check FROM pg_policies p
     WHERE p.schemaname=$1 ORDER BY p.tablename,p.policyname`,params);
  const relationGrants=await collect(`SELECT table_name,grantee,grantor,privilege_type,is_grantable
     FROM information_schema.role_table_grants WHERE table_schema=$1
     ORDER BY table_name,grantee,grantor,privilege_type`,params);
  const columnGrants=await collect(`SELECT table_name,column_name,grantee,grantor,privilege_type,is_grantable
     FROM information_schema.column_privileges WHERE table_schema=$1
     ORDER BY table_name,column_name,grantee,grantor,privilege_type`,params);
  const schemaGrants=await collect(`SELECT n.nspname,a.grantee::regrole::text AS grantee,
     a.grantor::regrole::text AS grantor,a.privilege_type,a.is_grantable
     FROM pg_namespace n CROSS JOIN LATERAL aclexplode(
       coalesce(n.nspacl,acldefault('n',n.nspowner))) a
     WHERE n.nspname=$1 ORDER BY grantee,privilege_type`,params);
  const roles=await collect(`SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,
     rolcanlogin,rolreplication,rolbypassrls FROM pg_roles
     WHERE rolname=ANY($1::text[]) ORDER BY rolname`,[[...roleNames]]);
  const memberships=await collect(`SELECT member.rolname AS member,role.rolname AS role,
     grantor.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option
     FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
     JOIN pg_roles role ON role.oid=m.roleid
     JOIN pg_roles grantor ON grantor.oid=m.grantor
     WHERE member.rolname=ANY($1::text[]) OR role.rolname=ANY($1::text[])
     ORDER BY member.rolname,role.rolname`,[[...roleNames]]);
  return {schema,namespaces,relations,columns,constraints,indexes,policies,
    relationGrants,columnGrants,schemaGrants,roles,memberships};
}
