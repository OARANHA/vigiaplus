import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(
 'schema/operational-homologation/alt0810c38-neon-hml-baseline-wave1.sql',
 'utf8'
);

const names=['reputation_targets','incidents','notification_channels','invoices'];
const role='vigia_hml_reader_20261114';

test('C38: HML-only pinned database, baseline, immutable no-production receipt',()=>{
 assert.match(source,/current_database\(\) <> 'vigiaplus_hml_20261114'/);
 assert.match(source,/pg_tables WHERE schemaname='public'\) <> 62/);
 assert.match(source,/068db8eaf3f6dc4ad7fbcf5014ffe687d077ae15/);
 assert.match(source,/production_ready boolean NOT NULL DEFAULT false CHECK \(production_ready=false\)/);
 assert.match(source,/scope text NOT NULL CHECK \(scope='ISOLATED_HML_ONLY'\)/);
 assert.match(source,/REVOKE USAGE ON SCHEMA public FROM PUBLIC/);
 assert.doesNotMatch(source,/\b(?:DATABASE_URL|NEON_API_KEY|PASSWORD\s*'|pg_dump|pg_restore)\b/i);
});

test('C38: enforce selective column access and fail-closed tenant isolation',()=>{
 const statements=source.split(';').map(s=>s.trim()).filter(Boolean);
 const policies=statements.filter(s=>s.includes('CREATE POLICY hml_tenant_select ON'));
 const forces=statements.filter(s=>s.includes('FORCE ROW LEVEL SECURITY'));
 const enables=statements.filter(s=>s.includes('ENABLE ROW LEVEL SECURITY'));
 assert.equal(policies.length,4);
 assert.equal(forces.length,4);
 assert.equal(enables.length,4);
 for(const name of names){
  const using=policies.find(p=>p.includes('ON public.'+name));
  assert.ok(using,'missing policy on '+name);
  assert.ok(using.includes('AS PERMISSIVE FOR SELECT TO '+role));
  assert.ok(using.includes("tenant_id = NULLIF(current_setting('app.tenant_id',true),'')::integer"));
  assert.ok(statements.some(s=>s.includes('ALTER TABLE public.'+name+' FORCE ROW LEVEL SECURITY')));
  assert.ok(statements.some(s=>s.includes('ALTER TABLE public.'+name+' ENABLE ROW LEVEL SECURITY')));
 }
 assert.match(source,/CREATE ROLE vigia_hml_reader_20261114\s+NOLOGIN NOSUPERUSER NOBYPASSRLS/);
 assert.match(source,/WITH SET TRUE, INHERIT FALSE/);
 assert.doesNotMatch(source,/\bCREATE POLICY\s+\w+\s+ON[^;]+USING\s*\(\s*true\s*\)/i);
 assert.doesNotMatch(source,/GRANT SELECT\s+ON\s+public\./i);
 assert.doesNotMatch(source,/GRANT SELECT[^;]+(?:private_text|pix_copia_cola|destination|keywords)/i);
});
