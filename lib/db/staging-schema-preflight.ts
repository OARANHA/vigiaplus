/**
 * ALT-08.10C — contrato PURO de leitura do inventário PostgreSQL.
 * Não importa getDb(), não inicializa schema, não altera permissões.
 */
export type StagingCatalog = {
 database:string;
 role:string;
 superuser:boolean;
 bypassRls:boolean;
 publicTables:number;
 publicPolicies:number;
 publicIndexes:number;
 publicConstraints:number;
 publicGrants:number;
 migrationLedger:boolean;
};
export const ALT0810C_DATABASE='vigia_alt086_staging_20261112';
export const ALT0810C_ROLE='vigia_alt087_staging_reader';

export function assertIsolatedStagingCatalog(
 c:StagingCatalog,
 expectedDatabase=ALT0810C_DATABASE,
 expectedRole=ALT0810C_ROLE,
):void {
 if(c.database!==expectedDatabase || c.role!==expectedRole ||
    c.superuser!==false || c.bypassRls!==false ||
    !Number.isSafeInteger(c.publicTables) ||
    !Number.isSafeInteger(c.publicPolicies) ||
    !Number.isSafeInteger(c.publicIndexes) ||
    !Number.isSafeInteger(c.publicConstraints) ||
    !Number.isSafeInteger(c.publicGrants) ||
    [c.publicTables,c.publicPolicies,c.publicIndexes,c.publicConstraints,c.publicGrants].some(v=>v<0) ||
    typeof c.migrationLedger!=='boolean') {
  throw Error('ALT0810C_CATALOG_TARGET_OR_ROLE_REJECTED');
 }
}

export function operationalSchemaReadiness(c:StagingCatalog){
 assertIsolatedStagingCatalog(c);
 return {
  readyForOperationalAuth: c.publicTables>0 && c.migrationLedger,
  status: c.publicTables===0?'EMPTY_STAGING':'MIGRATION_REVIEW_REQUIRED',
  // Nunca afirmar que tabelas presentes = schema completo/seguro.
  migratorAllowed:false,
  productionAllowed:false,
 } as const;
}

/** Só accepts uma URL dedicada sem interpolar host/banco/role. */
export function assertStagingReadOnlyEnv(env:Readonly<Record<string,string|undefined>>):void {
 if(env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.NODE_ENV==='production'||
  env.DATABASE_URL||env.VIGIA_RLS_MODE!=='ci-experimental'||
  env.ALT0810C_PREFLIGHT_CONFIRM!=='READ_ONLY_NEON_STAGING'||
  !env.RLS_DATABASE_URL||!/^\d+$/.test(env.GITHUB_RUN_ID??'')) {
  throw Error('ALT0810C_PREFLIGHT_CI_ONLY');
 }
 let u:URL;
 try{u=new URL(env.RLS_DATABASE_URL)}catch{throw Error('ALT0810C_PREFLIGHT_URL_INVALID')}
 if(!['postgres:','postgresql:'].includes(u.protocol)||
    !u.hostname.endsWith('.neon.tech')||
    decodeURIComponent(u.pathname.slice(1))!==ALT0810C_DATABASE ||
    decodeURIComponent(u.username)!==ALT0810C_ROLE){
  throw Error('ALT0810C_PREFLIGHT_WRONG_DB_OR_ROLE');
 }
}
