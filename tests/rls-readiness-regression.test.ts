import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessRlsReadiness, TENANT_RLS_TABLES } from '../lib/tenant/rls-preflight';

const tables = TENANT_RLS_TABLES.map((name) => ({
  name, owner: 'vigiaplus_migrator', rlsEnabled: true, forceRls: true,
}));
const role = { role: 'vigiaplus_runtime', superuser: false, bypassRls: false };
const policies = TENANT_RLS_TABLES.map((table) => ({
  table,
  qualification: "tenant_id = current_setting('app.tenant_id', true)::integer",
  withCheck: "tenant_id = current_setting('app.tenant_id', true)::integer",
}));

test('RLS readiness exige conexão transacional; Neon HTTP permanece NO-GO', () => {
  const issues = assessRlsReadiness({ role, tables, policies, connectionDriver: 'neon-http' });
  assert.ok(issues.some((s) => s.includes('Driver HTTP')));
});

test('RLS readiness reprova role com BYPASSRLS', () => {
  const issues = assessRlsReadiness({
    role: { ...role, bypassRls: true }, tables, policies, connectionDriver: 'transactional',
  });
  assert.ok(issues.some((s) => s.includes('BYPASSRLS')));
});

test('RLS readiness reprova policy com escopo ausente e WITH CHECK TRUE', () => {
  const unsafe = policies.map((p) => p.table === 'invoices' ? {
    ...p, qualification: "current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::integer",
    withCheck: 'true',
  } : p);
  const issues = assessRlsReadiness({ role, tables, policies: unsafe, connectionDriver: 'transactional' });
  assert.ok(issues.some((s) => s.includes('invoices')));
});

test('RLS readiness reprova tabela sem RLS', () => {
  const altered = tables.map((t) => t.name === 'payment_events' ? { ...t, rlsEnabled: false } : t);
  const issues = assessRlsReadiness({ role, tables: altered, policies, connectionDriver: 'transactional' });
  assert.ok(issues.some((s) => s.includes('payment_events')));
});

test('RLS readiness aceita apenas metadados mínimos seguros; não substitui teste de isolamento', () => {
  assert.deepEqual(assessRlsReadiness({ role, tables, policies, connectionDriver: 'transactional' }), []);
});
