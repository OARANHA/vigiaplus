import test from 'node:test';
import assert from 'node:assert/strict';
import {ALT0810C19,ALT0810C19_POLICY_SQL,
 assertAlt0810c19DisposableEnv} from '../lib/db/alt0810c19-membership-rls';

test('ALT-08.10C.19: versioned candidate never authorizes operational deploy',()=>{
 assert.equal(ALT0810C19.status,'disposable-ci-only');
 assert.equal(ALT0810C19.operationalMigrationAuthorized,false);
 assert.equal(ALT0810C19.stagingAuthorized,false);
 assert.equal(ALT0810C19.productionAuthorized,false);
 assert.equal(ALT0810C19_POLICY_SQL.length,4);
 assert.ok(ALT0810C19_POLICY_SQL.some(s=>s.includes('FORCE ROW LEVEL SECURITY')));
 const policies=ALT0810C19_POLICY_SQL.filter(s=>s.startsWith('CREATE POLICY'));
 assert.equal(policies.length,2);
 for(const sql of policies){
  assert.match(sql,/current_setting\('app\.tenant_id',true\)/);
  assert.match(sql,/current_setting\('app\.user_id',true\)/);
  assert.doesNotMatch(sql,/current_setting\([^)]*\)\s+IS\s+NULL\s+OR/i);
  assert.doesNotMatch(sql,/USING\s*\(true\)/i);
 }
});
test('ALT-08.10C.19: explicit CI guard rejects remote or unrestricted environment',()=>{
 const valid={CI:'true',GITHUB_ACTIONS:'true',ALT0810C19_EPHEMERAL:'1',
  RUNNER_OS:'Linux',PGHOST:'127.0.0.1',PGPORT:'5432',
  PGDATABASE:'vigia_alt081_ci',PGUSER:'vigia_ci',
  PGPASSWORD:'isolated_ci_only',DATABASE_URL:'',RLS_DATABASE_URL:''};
 assert.doesNotThrow(()=>assertAlt0810c19DisposableEnv(valid));
 assert.throws(()=>assertAlt0810c19DisposableEnv({...valid,DATABASE_URL:'postgres://remote'}),/DISPOSABLE/);
 assert.throws(()=>assertAlt0810c19DisposableEnv({...valid,PGHOST:'example.com'}),/DISPOSABLE/);
 assert.throws(()=>assertAlt0810c19DisposableEnv({...valid,ALT0810C19_EPHEMERAL:'0'}),/DISPOSABLE/);
});
