import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tenantConnectionConfig, rowsOf } from '../lib/tenant/transaction-gateway';

const main = 'postgresql://owner:abc@localhost:5432/vigiaplus';
const tenant = 'postgresql://tenant_user:abc@localhost:5432/vigiaplus';
test('falha quando credencial de escopo não existe ou é igual à do migrador', () => {
  assert.throws(() => tenantConnectionConfig({ DATABASE_URL: main }), /TENANT_DATABASE_URL/);
  assert.throws(() => tenantConnectionConfig({ DATABASE_URL: main, TENANT_DATABASE_URL: main }), /role.*diferir/);
  assert.throws(() => tenantConnectionConfig({ DATABASE_URL: main, TENANT_DATABASE_URL: 'https://example.com' }), /PostgreSQL/);
});
test('configuração separada funciona sem estabelecer conexão externa', () => {
  if (typeof WebSocket !== 'undefined') {
    assert.equal(tenantConnectionConfig({ DATABASE_URL: main, TENANT_DATABASE_URL: tenant }), tenant);
  }
});
test('normaliza linhas PostgreSQL sem supor resultados inexistentes', () => {
  assert.deepEqual(rowsOf({ rows: [{ role: 'vigiaplus_app' }] }), [{ role: 'vigiaplus_app' }]);
  assert.deepEqual(rowsOf([{ role: 'x' }]), [{ role: 'x' }]);
  assert.throws(() => rowsOf({ other: true }), /retorno inesperado/);
});

test('catálogo recusa superuser antes de executar queries de cliente', async () => {
  const { verifyRestrictedRuntimeRole } = await import('../lib/tenant/transaction-gateway');
  let queries = 0;
  const fake = {
    execute: async () => {
      queries++;
      if (queries === 1) return { rows: [{ role: 'postgres', superuser: true, bypass_rls: true }] };
      return { rows: [] };
    },
  };
  await assert.rejects(
    () => verifyRestrictedRuntimeRole(fake as never),
    /RLS NO-GO/,
  );
  assert.equal(queries, 3);
});

test('preflight impede SELECT irrestrito quando policy contém USING true', async () => {
  const { assessRlsReadiness, TENANT_RLS_TABLES } = await import('../lib/tenant/rls-preflight');
  const tables = TENANT_RLS_TABLES.map((name) => ({
    name, owner: 'migrator', rlsEnabled: true, forceRls: false,
  }));
  const policies = TENANT_RLS_TABLES.map((table) => ({
    table, qualification: "tenant_id = nullif(current_setting('app.tenant_id', true),'')::integer",
    withCheck: "tenant_id = nullif(current_setting('app.tenant_id', true),'')::integer",
  }));
  assert.deepEqual(assessRlsReadiness({
    role: { role: 'vigiaplus_app', superuser: false, bypassRls: false },
    tables, policies, connectionDriver: 'transactional',
  }), []);
  policies[0].qualification = '(true)';
  assert.ok(assessRlsReadiness({
    role: { role: 'vigiaplus_app', superuser: false, bypassRls: false },
    tables, policies, connectionDriver: 'transactional',
  }).some((issue) => issue.includes('Política permissiva')));
});
