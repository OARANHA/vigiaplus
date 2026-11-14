import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNeonRlsEnvironment, withNeonRlsPool,
  type NeonRlsEnvironment } from '../lib/tenant/neon-rls-adapter';

const valid:NeonRlsEnvironment={
  VIGIA_RLS_MODE:'ci-experimental',
  CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test',
  DATABASE_URL:'',
  RLS_DATABASE_URL:'postgresql://ci_user:ci_pw@ep-test.us-east-1.aws.neon.tech/ci_db?sslmode=require',
};

test('ALT-08.3 Neon adapter: disabled by default, no production or normal CI',()=>{
  for(const patch of [
    {VIGIA_RLS_MODE:undefined},
    {VIGIA_RLS_MODE:'enabled'},
    {NODE_ENV:'production'},
    {CI:'false'},
    {GITHUB_ACTIONS:undefined},
    {DATABASE_URL:'postgresql://live-db'},
    {RLS_DATABASE_URL:undefined},
  ]) {
    assert.throws(()=>validateNeonRlsEnvironment({...valid,...patch}),
      /RLS_NEON_ADAPTER_DISABLED/);
  }
});
test('ALT-08.3 Neon adapter: checks PostgreSQL protocol and Neon hostname',()=>{
  assert.equal(validateNeonRlsEnvironment(valid),valid.RLS_DATABASE_URL);
  for(const value of [
    'https://ep-test.us-east-1.aws.neon.tech/ci_db',
    'postgresql://ci_user:pw@localhost/ci_db',
    'postgresql://ci_user:pw@neon.tech.attacker.invalid/ci_db',
    'not-a-url',
  ]){
    assert.throws(()=>validateNeonRlsEnvironment({...valid,RLS_DATABASE_URL:value}));
  }
});
test('ALT-08.3 Neon adapter: invalid mode never opens a connection',async()=>{
  await assert.rejects(withNeonRlsPool({...valid,VIGIA_RLS_MODE:'off'},
    async()=>{throw Error('operation must never run')}),/RLS_NEON_ADAPTER_DISABLED/);
});
