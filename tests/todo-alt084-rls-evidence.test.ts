import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedEvidenceLimit,isAlt084EvidencePilotEnabled,selectRlsEvidence} from '../lib/tenant/rls-evidence';
import {ALT084_EVIDENCE_POLICY_SQL,ALT084_EVIDENCE_ROLLBACK_SQL} from '../lib/tenant/rls-evidence-policies';

test('ALT-08.4: default off, production impossible, no client-controlled flags',()=>{
  const base:NodeJS.ProcessEnv={
    VIGIA_ALT084_EVIDENCE_MODE:'ci-read-only',VIGIA_RLS_MODE:'ci-experimental',
    CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test',DATABASE_URL:'',
  };
  assert.equal(isAlt084EvidencePilotEnabled({}),false);
  assert.equal(isAlt084EvidencePilotEnabled(base),true);
  for(const override of [
    {NODE_ENV:'production'},{CI:'false'},{GITHUB_ACTIONS:'false'},
    {DATABASE_URL:'postgres://real'},{VIGIA_ALT084_EVIDENCE_MODE:'on'},
    {VIGIA_RLS_MODE:'enabled'},
  ])assert.equal(isAlt084EvidencePilotEnabled({...base,...override}),false);
});
test('ALT-08.4: query fixa, LIMIT parametrizado e sem PII',async()=>{
  let capturedSql='',capturedArgs:readonly unknown[]=[];
  const rows=await selectRlsEvidence(async(s,p)=>{
    capturedSql=s;capturedArgs=p??[];
    return {rows:[{id:1,title:'Teste',url:'https://example.com',source:'rss',
      publishedAt:'2026-11-12T00:00:00.000Z',projectName:'Projeto A'}],rowCount:1};
  },500);
  assert.equal(rows[0].id,1);
  assert.deepEqual(capturedArgs,[25]);
  assert.match(capturedSql,/JOIN public\.projects/);
  assert.doesNotMatch(capturedSql,/content|destination|SELECT \*/i);
  for(const n of [NaN,Infinity,1.1]) assert.throws(()=>checkedEvidenceLimit(n));
  assert.equal(checkedEvidenceLimit(-1),1);
});
test('ALT-08.4: política SELECT-only para projects e mentions, rollback explícito',()=>{
  assert.equal(ALT084_EVIDENCE_POLICY_SQL.length,6);
  assert.equal(ALT084_EVIDENCE_ROLLBACK_SQL.length,6);
  assert.ok(ALT084_EVIDENCE_POLICY_SQL.every(s=>!s.includes('FOR ALL')));
  assert.ok(ALT084_EVIDENCE_POLICY_SQL.some(s=>s.includes('EXISTS')));
  assert.ok(ALT084_EVIDENCE_POLICY_SQL.some(s=>s.includes('app.tenant_id')));
});
