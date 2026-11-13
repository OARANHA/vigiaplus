/**
 * ALT-08.10C.11: offline-only, deterministic operational migration evidence.
 *
 * No SQL execution, database imports, permissions or deployment entry point.
 * NEVER interpret this plan as approval or as a reversible migration.
 */
import {createHash} from 'node:crypto';
import type {BootstrapInventory,InventoryEntry} from './bootstrap-dependencies';

export const ALT0810C11_POLICY={
 version:'alt0810c11-evidence-v1',
 status:'offline-review-only',
 migrationAuthorized:false,
 stagingAuthorized:false,
 productionAuthorized:false,
 migrationRunnerActivated:false,
 prerequisites:[
  'verified_pg_dump_custom_format_and_restore_rehearsal',
  'locked_schema_and_data_diff_for_exact_target',
  'target_database_and_role_attestation',
  'separate_migrator_runtime_reader_credentials',
  'rollback_plan_for_data_and_existing_objects',
  'explicit_human_staging_approval',
  'functional_auth_memberships_entitlements_rls_e2e',
 ] as const,
} as const;

export type MigrationEvidenceStep={
 ordinal:number;kind:InventoryEntry['kind'];target:string;
 sha256:string;prerequisites:number[];externalDependencies:string[];
 requiresDataBackup:boolean;requiresCatalogBackup:boolean;
 reversibleAutomatically:false;
};
export type MigrationEvidencePlan={
 version:string;sourceSha256:string;planSha256:string;
 statementCount:number;steps:MigrationEvidenceStep[];
 requiresPhysicalBackup:true;requiresLogicalBackup:true;
 rollbackExecutable:false;migrationAuthorized:false;
 stagingAuthorized:false;productionAuthorized:false;
 blockingReasons:string[];
};

const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const shaRe=/^[0-9a-f]{64}$/;
function stableJson(value:unknown):string{return JSON.stringify(value)}

export function buildOperationalMigrationEvidence(
 statements:readonly string[],inventory:BootstrapInventory):MigrationEvidencePlan{
 if(statements.length!==186||inventory.entries.length!==statements.length||
    inventory.readyForMigration!==false)
  throw Error('ALT0810C11_INVALID_LEGACY_SNAPSHOT');
 const tableCreates=new Map<string,number>();
 const lastByTarget=new Map<string,number>();
 const steps:MigrationEvidenceStep[]=[];
 const hashes:string[]=[];
 for(let i=0;i<statements.length;i++){
  const entry=inventory.entries[i];
  const sql=statements[i].trim();
  const actual=digest(sql);
  if(entry.ordinal!==i+1||entry.sha256!==actual||!shaRe.test(entry.sha256)||
     !entry.target||!entry.dependsOn.every(x=>typeof x==='string')||
     !['create-table','alter-table','create-index','data-update'].includes(entry.kind))
   throw Error('ALT0810C11_STATEMENT_DRIFT:'+String(i+1));
  const predecessors=new Set<number>();
  const unresolved=new Set<string>();
  for(const dep of entry.dependsOn){
   const preceding=lastByTarget.get(dep)??tableCreates.get(dep);
   if(preceding!==undefined)predecessors.add(preceding);
   else if(dep!==entry.target)unresolved.add(dep);
  }
  const prior=lastByTarget.get(entry.target);
  if(prior!==undefined)predecessors.add(prior);
  if(entry.kind==='create-table'){
   if(tableCreates.has(entry.target))throw Error('ALT0810C11_DUPLICATE_CREATE:'+entry.target);
   tableCreates.set(entry.target,entry.ordinal);
  }else if(!tableCreates.has(entry.target)){
   unresolved.add(entry.target);
  }
  if(unresolved.size)throw Error('ALT0810C11_UNRESOLVED_DEPENDENCY:'+entry.ordinal);
  const step:MigrationEvidenceStep={
   ordinal:entry.ordinal,kind:entry.kind,target:entry.target,sha256:actual,
   prerequisites:[...predecessors].filter(x=>x<entry.ordinal).sort((a,b)=>a-b),
   externalDependencies:[],
   requiresDataBackup:entry.kind==='data-update'||entry.kind==='alter-table',
   requiresCatalogBackup:true,reversibleAutomatically:false,
  };
  hashes.push(actual);steps.push(step);lastByTarget.set(entry.target,entry.ordinal);
 }
 const sourceSha256=digest(hashes.join('\n'));
 const planSha256=digest(stableJson({version:ALT0810C11_POLICY.version,
  sourceSha256,steps}));
 const blockingReasons=[
  'legacy_DDL_contains_data_update',
  'unreviewed_existing_objects_and_column_defaults',
  'no_operational_backup_or_restore_attestation',
  'no_production_safe_role_partition',
  'no_end_to_end_authorization_and_RLS_homologation',
  'implicit_legacy_bootstrap_and_seeds_still_active',
  'no_approved_staging_migration_or_compensation',
 ];
 return {
  version:ALT0810C11_POLICY.version,sourceSha256,planSha256,
  statementCount:steps.length,steps,
  requiresPhysicalBackup:true,requiresLogicalBackup:true,
  rollbackExecutable:false,migrationAuthorized:false,
  stagingAuthorized:false,productionAuthorized:false,blockingReasons,
 };
}
/** Explicitly refuse using this evidence as a runner even if every row is valid. */
export function assertNotExecutable(plan:MigrationEvidencePlan):never{
 void plan;
 throw Error('ALT0810C11_PLAN_IS_EVIDENCE_ONLY_NOT_EXECUTABLE');
}
