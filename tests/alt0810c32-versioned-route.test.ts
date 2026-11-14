import test from 'node:test';
import assert from 'node:assert/strict';
import {ALT0810C32, transactionalPermissionsMode}
 from '../lib/tenant/alt0810c32-versioned-route';

const ci={
 CI:'true',GITHUB_ACTIONS:'true',RUNNER_OS:'Linux',
 ALT0810C32_EPHEMERAL:'1',PGHOST:'127.0.0.1',PGPORT:'5432',
 PGUSER:'vigia_ci',PGPASSWORD:'isolated_ci_only',
 PGDATABASE:'vigia_alt081_ci',DATABASE_URL:'',RLS_DATABASE_URL:'',
 NODE_ENV:'test',DEMO_MODE:'0',
} as const;

test('ALT-08.10C.32 defaults OFF, rollback OFF, production opt-in refused',()=>{
 assert.equal(ALT0810C32.productionEnabled,false);
 assert.equal(ALT0810C32.stagingEnabled,false);
 assert.equal(transactionalPermissionsMode({}), 'off');
 assert.equal(transactionalPermissionsMode({...ci,ALT0810C32_MODE:'off'}),'off');
 assert.equal(transactionalPermissionsMode({...ci,ALT0810C32_MODE:''}),'off');
 assert.equal(transactionalPermissionsMode({...ci,ALT0810C32_MODE:'disposable-ci'}),'disposable-ci');
 for(const wrong of [
  {CI:'false'},{GITHUB_ACTIONS:'false'},{RUNNER_OS:'Windows'},
  {ALT0810C32_EPHEMERAL:'0'},{PGHOST:'192.0.2.1'},
  {PGDATABASE:'production'},{PGUSER:'postgres'},
  {DATABASE_URL:'postgresql://invalid'}, {RLS_DATABASE_URL:'postgresql://invalid'},
  {NODE_ENV:'production'}, {DEMO_MODE:'1'},
  {ALT0810C32_MODE:'staging'}, {ALT0810C32_MODE:'production'},
 ]) {
  assert.throws(()=>transactionalPermissionsMode({
   ...ci,ALT0810C32_MODE:'disposable-ci',...wrong,
  }),/ALT0810C32_TRANSACTIONAL_MODE_NOT_AUTHORIZED/);
 }
});
