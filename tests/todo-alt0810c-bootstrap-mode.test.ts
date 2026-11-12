import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDbBootstrapMode} from '../lib/db/bootstrap-mode';

const ci:Record<string,string|undefined>={
 CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test',
 DEMO_MODE:'0',VIGIA_RLS_MODE:'ci-experimental',
 GITHUB_RUN_ID:'12345',
 VIGIA_DB_BOOTSTRAP_MODE:'preprovisioned-staging-ci',
 VIGIA_DB_BOOTSTRAP_CONFIRM:'READ_EXISTING_SCHEMA_ONLY',
 DATABASE_URL:'postgresql://vigia_alt087_staging_reader:test@ep-safe.neon.tech/vigia_alt086_staging_20261112',
 RLS_DATABASE_URL:'',
};
test('ALT-08.10C.4: default and explicit legacy bootstrap unchanged',()=>{
 assert.equal(resolveDbBootstrapMode({}),'legacy-bootstrap');
 assert.equal(resolveDbBootstrapMode({NODE_ENV:'production'}),'legacy-bootstrap');
 assert.equal(resolveDbBootstrapMode({VIGIA_DB_BOOTSTRAP_MODE:'legacy-bootstrap'}),'legacy-bootstrap');
});
test('ALT-08.10C.4: opt-in requires exact non-privileged staging target and CI',()=>{
 assert.equal(resolveDbBootstrapMode(ci),'preprovisioned-staging-ci');
 for(const change of [
  {VIGIA_DB_BOOTSTRAP_MODE:'skip'}, {CI:'false'},
  {GITHUB_ACTIONS:'false'}, {NODE_ENV:'production'},
  {DEMO_MODE:'1'}, {VIGIA_DB_BOOTSTRAP_CONFIRM:'wrong'},
  {VIGIA_RLS_MODE:'enabled'}, {GITHUB_RUN_ID:'invalid'},
  {DATABASE_URL:''},{RLS_DATABASE_URL:'postgresql://anything'},
  {DATABASE_URL:'postgresql://owner:test@ep-safe.neon.tech/vigia_alt086_staging_20261112'},
  {DATABASE_URL:'postgresql://vigia_alt087_staging_reader:test@ep-safe.neon.tech/production'},
  {DATABASE_URL:'postgresql://vigia_alt087_staging_reader:test@evil.example/vigia_alt086_staging_20261112'},
 ]){
  assert.throws(()=>resolveDbBootstrapMode({...ci,...change}));
 }
});
