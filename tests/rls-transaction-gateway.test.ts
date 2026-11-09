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
