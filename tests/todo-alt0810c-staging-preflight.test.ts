import test from 'node:test';
import assert from 'node:assert/strict';
import {
 assertIsolatedStagingCatalog,assertStagingReadOnlyEnv,operationalSchemaReadiness,
 type StagingCatalog
} from '../lib/db/staging-schema-preflight';

const catalog:StagingCatalog={
 database:'vigia_alt086_staging_20261112',role:'vigia_alt087_staging_reader',
 superuser:false,bypassRls:false,publicTables:0,
 publicPolicies:0,publicIndexes:0,publicConstraints:0,
 publicGrants:0,migrationLedger:false,
};
const env:Readonly<Record<string,string|undefined>>={
 CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test',
 DATABASE_URL:'',VIGIA_RLS_MODE:'ci-experimental',
 ALT0810C_PREFLIGHT_CONFIRM:'READ_ONLY_NEON_STAGING',
 GITHUB_RUN_ID:'12345',
 RLS_DATABASE_URL:'postgresql://vigia_alt087_staging_reader:synthetic@ep-test.neon.tech/vigia_alt086_staging_20261112'
};
test('ALT-08.10C: baseline empty is NOT operational-ready',()=>{
 assert.doesNotThrow(()=>assertIsolatedStagingCatalog(catalog));
 assert.deepEqual(operationalSchemaReadiness(catalog),{
  readyForOperationalAuth:false,status:'EMPTY_STAGING',
  migratorAllowed:false,productionAllowed:false
 });
});
test('ALT-08.10C: existing tables never imply deployment approval',()=>{
 const c={...catalog,publicTables:12,publicIndexes:15,migrationLedger:true};
 assert.deepEqual(operationalSchemaReadiness(c),{
  readyForOperationalAuth:true,status:'MIGRATION_REVIEW_REQUIRED',
  migratorAllowed:false,productionAllowed:false
 });
});
test('ALT-08.10C: catalog rejects owner, BYPASS, mismatched DB and invalid counts',()=>{
 for(const c of [
  {...catalog,role:'vigia_alt083_ci_20261112_owner'},
  {...catalog,superuser:true},{...catalog,bypassRls:true},
  {...catalog,database:'production'},
  {...catalog,publicTables:NaN},{...catalog,publicPolicies:-1},
  {...catalog,publicIndexes:Infinity},
  {...catalog,publicGrants:0.25},
 ]){
  assert.throws(()=>assertIsolatedStagingCatalog(c));
 }
});
test('ALT-08.10C: preflight CI only, strictly read-only reader secret',()=>{
 assert.doesNotThrow(()=>assertStagingReadOnlyEnv(env));
 for(const change of [
  {CI:'false'},{GITHUB_ACTIONS:'false'},{NODE_ENV:'production'},
  {DATABASE_URL:'postgresql://anything'},{VIGIA_RLS_MODE:'on'},
  {ALT0810C_PREFLIGHT_CONFIRM:'wrong'},{GITHUB_RUN_ID:''},
  {RLS_DATABASE_URL:'invalid'},
  {RLS_DATABASE_URL:'postgresql://vigia_alt083_ci_20261112_owner:synthetic@ep-test.neon.tech/vigia_alt086_staging_20261112'},
  {RLS_DATABASE_URL:'postgresql://vigia_alt087_staging_reader:synthetic@ep-test.neon.tech/production'},
  {RLS_DATABASE_URL:'postgresql://vigia_alt087_staging_reader:synthetic@malicious.example/vigia_alt086_staging_20261112'}
 ])assert.throws(()=>assertStagingReadOnlyEnv({...env,...change}));
});
