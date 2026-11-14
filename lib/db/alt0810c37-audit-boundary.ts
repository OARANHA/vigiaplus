/**
 * ALT-08.10C.37 — static guard for human-authorized catalog-only SQL pack.
 * Never connects to a database and never interprets arbitrary caller SQL.
 * This is a review aid, not a full SQL parser or production authorization.
 */
export const ALT0810C37=Object.freeze({
  version:'alt0810c37-crosscluster-postcommit-backup-v1',
  realDatabaseAccessAuthorized:false,
  backupOfOperationalDataAuthorized:false,
  stagingAuthorized:false,neonAuthorized:false,
  productionAuthorized:false,mergeAuthorized:false,
});

export function validateC37ReadOnlyAudit(raw:string):void{
  if(typeof raw!=='string'||raw.length<2500||raw.length>20000)
    throw Error('ALT0810C37_AUDIT_SQL_DENIED');
  // Strip only SQL line comments from the pinned repository artifact.
  // No substitutions of identifiers, statements, role or credentials.
  const sql=raw.split('\n').filter(line=>!line.trimStart().startsWith('--'))
    .join('\n');
  if(!/^\s*BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/i.test(sql)||
     !/ROLLBACK;\s*$/i.test(sql)||
     !/SET LOCAL statement_timeout\s*=\s*'15s';/i.test(sql)||
     !/SET LOCAL lock_timeout\s*=\s*'2s';/i.test(sql)||
     !/FROM pg_policy\s+p/i.test(sql)||
     !/FROM pg_roles/i.test(sql)||
     !/FROM pg_auth_members/i.test(sql)||
     !/aclexplode\s*\(/i.test(sql)||
     (sql.match(/\bpg_get_expr\s*\(/gi)??[]).length!==2||
     !/current_setting\s*\(\s*'transaction_read_only'\s*\)/i.test(sql)||
     /\b(?:ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CALL|COPY|DO|EXECUTE|VACUUM|ANALYZE|MERGE)\b/i.test(sql)||
     /\b(?:pg_authid|set_config|dblink|pg_sleep|pg_terminate_backend)\b/i.test(sql)||
     /\b(?:COMMIT|SET ROLE|RESET ROLE)\b/i.test(sql)) {
    throw Error('ALT0810C37_AUDIT_SQL_DENIED');
  }
  const statements=sql.split(';').map(x=>x.trim()).filter(Boolean);
  // One BEGIN READ ONLY, two safe SET LOCAL, eight read-only catalog queries, ROLLBACK.
  if(statements.length!==12||statements.filter(x=>/^SELECT\b/i.test(x)).length!==7||
     statements.filter(x=>/^WITH\b/i.test(x)).length!==1||
     !statements.every(x=>/^(?:BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY|SET LOCAL (?:statement_timeout|lock_timeout)|SELECT|WITH|ROLLBACK)\b/i.test(x))) {
    throw Error('ALT0810C37_AUDIT_SQL_DENIED');
  }
}
