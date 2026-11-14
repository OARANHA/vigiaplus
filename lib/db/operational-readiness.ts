/**
 * ALT-08.10C.9 — operational schema preflight, advisory and fail closed.
 * Consumes disposable pg_catalog metadata only; DOES NOT authorize migrations.
 */
import type {CatalogSnapshot} from './disposable-catalog-snapshot';

const required=['users','memberships','tenants','subscriptions','plans',
 'plan_features','tenant_features'] as const;

export type OperationalReadinessReport={
 readyForOperationalAuth:false;
 migrationAllowed:false;
 productionAllowed:false;
 missingTables:string[];
 unprotectedTables:string[];
 missingMigrationLedger:boolean;
 missingTenantIsolationEvidence:boolean;
 evidence:'CATALOG_ONLY_NOT_AUTHORIZATION';
};

function decode(rows:readonly string[]):Record<string,unknown>[]{
 return rows.map(item=>{
  const parsed:unknown=JSON.parse(item);
  if(!parsed || typeof parsed!=='object'||Array.isArray(parsed))
    throw Error('ALT0810C9_INVALID_CATALOG_ROW');
  return parsed as Record<string,unknown>;
 });
}

/** Fail closed even when every catalog flag appears present: HTTP/RLS tests,
 * membership revocation and real credentials require independent approval. */
export function assessOperationalReadiness(s:CatalogSnapshot):OperationalReadinessReport{
 if(!/^alt0810c6_[a-z0-9_]+$/.test(s.schema))
  throw Error('ALT0810C9_DISPOSABLE_SCOPE_ONLY');
 const relations=decode(s.relations).filter(r=>r.relkind==='r'||r.relkind==='p');
 const tableNames=new Set(relations.map(r=>String(r.relname)));
 const missingTables=required.filter(name=>!tableNames.has(name));
 const unprotectedTables=relations.filter(r=>required.includes(r.relname as typeof required[number]) &&
  (r.relrowsecurity!==true||r.relforcerowsecurity!==true)).map(r=>String(r.relname)).sort();
 const policies=decode(s.policies);
 const missingTenantIsolationEvidence=required.some(name=>
  !policies.some(p=>p.tablename===name && typeof p.qual==='string' && p.qual.length>0));
 return {
  readyForOperationalAuth:false,migrationAllowed:false,productionAllowed:false,
  missingTables,unprotectedTables,
  missingMigrationLedger:!tableNames.has('schema_migrations'),
  missingTenantIsolationEvidence,
  evidence:'CATALOG_ONLY_NOT_AUTHORIZATION'
 };
}
