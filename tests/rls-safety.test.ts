import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeTenantScope, TenantScopeUnavailableError } from '../lib/tenant/scope';
import { assessRlsReadiness, TENANT_RLS_TABLES } from '../lib/tenant/rls-preflight';

test('RLS: nenhuma query ou callback roda sem transação suportada', async () => {
  let touched = false;
  await assert.rejects(
    () => executeTenantScope({}, 1, async () => { touched = true; return 42; }),
    TenantScopeUnavailableError,
  );
  await assert.rejects(
    () => executeTenantScope({ transaction: async () => { throw new Error('No transactions support in neon-http driver'); } }, 1,
      async () => { touched = true; return 42; }),
    TenantScopeUnavailableError,
  );
  assert.equal(touched, false);
});
test('RLS: SET LOCAL ocorre antes de executar callback e recebe mesmo tx', async () => {
  const events: string[] = [];
  const tx = { execute: async () => { events.push('set-local'); return undefined; } };
  const result = await executeTenantScope({ transaction: async (callback) => callback(tx as never) }, 3,
    async (executor) => {
      assert.equal(executor, tx);
      events.push('callback');
      return 7;
    });
  assert.equal(result, 7);
  assert.deepEqual(events, ['set-local', 'callback']);
});
test('RLS: IDs inválidos não executam transaction', async () => {
  await assert.rejects(
    () => executeTenantScope({ transaction: async () => 1 }, 0, async () => 1), /inteiro positivo/,
  );
});
test('preflight detecta policies permissivas e driver Neon HTTP', () => {
  const tables = TENANT_RLS_TABLES.map((name) => ({
    name, owner: 'migrator', rlsEnabled: true, forceRls: false,
  }));
  const policies = TENANT_RLS_TABLES.map((table) => ({
    table, qualification: "current_setting('app.tenant_id', true) IS NULL OR tenant_id = current_setting('app.tenant_id', true)::integer",
    withCheck: "tenant_id = current_setting('app.tenant_id', true)::integer",
  }));
  const issues = assessRlsReadiness({
    role: { role: 'vigiaplus_app', superuser: false, bypassRls: false },
    tables, policies, connectionDriver: 'neon-http',
  });
  assert.ok(issues.some((item) => item.includes('Driver HTTP')));
  assert.ok(issues.some((item) => item.includes('Política permissiva')));
});
test('preflight detecta owner sem FORCE e role BYPASSRLS', () => {
  const issues = assessRlsReadiness({
    role: { role: 'owner', superuser: false, bypassRls: true },
    tables: TENANT_RLS_TABLES.map((name) => ({ name, owner: 'owner', rlsEnabled: true, forceRls: false })),
    policies: TENANT_RLS_TABLES.map((table) => ({
      table, qualification: "tenant_id = current_setting('app.tenant_id', true)::integer",
      withCheck: "tenant_id = current_setting('app.tenant_id', true)::integer",
    })),
    connectionDriver: 'transactional',
  });
  assert.ok(issues.some((item) => item.includes('BYPASSRLS')));
  assert.ok(issues.some((item) => item.includes('sem FORCE')));
});
