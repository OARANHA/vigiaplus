import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ALT0810_FLAG,alt0810StagingRequested,assertAlt0810StagingEnvironment,
} from '../lib/tenant/alt0810-next-staging';

const safe:NodeJS.ProcessEnv={
 [ALT0810_FLAG]:'isolated-next-auth',
 CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test',
 DEMO_MODE:'0',DATABASE_URL:'',
 VIGIA_RLS_MODE:'ci-experimental',
 ALT0810_STAGING_CONFIRM:'NEXT_REAL_ROUTE_SYNTHETIC_ONLY',
 GITHUB_RUN_ID:'123456',
 RLS_DATABASE_URL:'postgresql://vigia_alt087_staging_reader:fake@ep-safe.neon.tech/vigia_alt086_staging_20261112',
};
test('ALT-08.10: pilot is opt-in and not enabled by requests',()=>{
 assert.equal(alt0810StagingRequested({}),false);
 assert.equal(alt0810StagingRequested(safe),true);
 assert.doesNotThrow(()=>assertAlt0810StagingEnvironment(safe));
});
test('ALT-08.10: deny production, wrong role/db and partial CI flags before opening Neon',()=>{
 for(const change of [
  {[ALT0810_FLAG]:'enabled'},
  {CI:'false'},
  {GITHUB_ACTIONS:'false'},
  {NODE_ENV:'production'},
  {DEMO_MODE:'1'},
  {DATABASE_URL:'postgres://operational'},
  {VIGIA_RLS_MODE:'enabled'},
  {ALT0810_STAGING_CONFIRM:'wrong'},
  {GITHUB_RUN_ID:''},
  {RLS_DATABASE_URL:'postgresql://vigia_alt083_ci_20261112_owner:fake@ep-safe.neon.tech/vigia_alt086_staging_20261112'},
  {RLS_DATABASE_URL:'postgresql://vigia_alt087_staging_reader:fake@ep-safe.neon.tech/production'},
  {RLS_DATABASE_URL:'postgresql://vigia_alt087_staging_reader:fake@evil.example/vigia_alt086_staging_20261112'},
 ])assert.throws(()=>assertAlt0810StagingEnvironment({...safe,...change}));
});
