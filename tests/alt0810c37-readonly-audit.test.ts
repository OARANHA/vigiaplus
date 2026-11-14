import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ALT0810C37,validateC37ReadOnlyAudit} from
  '../lib/db/alt0810c37-audit-boundary';
const sql=readFileSync(
  'schema/operational-rls/alt0810c37-authorized-readonly-audit.sql','utf8');

test('ALT-08.10C.37 defaults deny all remote access and backup of real data',()=>{
  for(const value of Object.values(ALT0810C37)){
    if(typeof value==='boolean')assert.equal(value,false);
  }
  assert.doesNotThrow(()=>validateC37ReadOnlyAudit(sql));
});

test('ALT-08.10C.37 rejects any change to READ ONLY and catalog statements',()=>{
  const bad=[
    sql.replace('REPEATABLE READ READ ONLY','REPEATABLE READ READ WRITE'),
    sql.replace('ROLLBACK;','COMMIT;'),
    sql.replace('ROLLBACK;','GRANT SELECT ON users TO PUBLIC;\nROLLBACK;'),
    sql.replace('ROLLBACK;','ALTER TABLE users DISABLE ROW LEVEL SECURITY;\nROLLBACK;'),
    sql.replace('ROLLBACK;',"SELECT set_config('app.tenant_id','1',false);\nROLLBACK;"),
    sql.replace('ROLLBACK;','SELECT * FROM pg_authid;\nROLLBACK;'),
    sql.replace('FROM pg_policy p','FROM pg_custom_policy p'),
    sql.replace('FROM pg_roles','FROM pg_profiles'),
    sql.replace('SET LOCAL statement_timeout',"SET statement_timeout"),
    sql.replace('FROM pg_auth_members','FROM pg_shadow_members'),
    sql.replace('pg_get_expr','pg_get_data'),
    sql.replace('ROLLBACK;',''),
  ];
  for(const candidate of bad){
    assert.notEqual(candidate,sql,'test mutation must change SQL');
    assert.throws(()=>validateC37ReadOnlyAudit(candidate),
      /ALT0810C37_AUDIT_SQL_DENIED/);
  }
});
