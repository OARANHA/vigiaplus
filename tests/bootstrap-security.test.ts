import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveBootstrapAdmin, shouldSeedSampleTenants } from '../lib/db/bootstrap-auth';

test('bootstrap não oferece conta com senha padrão sem credenciais explícitas', () => {
  assert.equal(resolveBootstrapAdmin({ NODE_ENV: 'development' }), null);
  assert.throws(() => resolveBootstrapAdmin({ NODE_ENV: 'production' }), /ADMIN_EMAIL e ADMIN_PASSWORD/);
  assert.throws(() => resolveBootstrapAdmin({ NODE_ENV: 'production', ADMIN_EMAIL: 'x@y.com', ADMIN_PASSWORD: 'fraca' }), /12\+/);
});
test('bootstrap exige senha forte e troca obrigatória', () => {
  const user = resolveBootstrapAdmin({
    NODE_ENV: 'production', ADMIN_EMAIL: '  Owner@Exemplo.com ',
    ADMIN_PASSWORD: 'ExemploSeguro2026_', ADMIN_NAME: 'Dono',
  });
  assert.equal(user?.email, 'owner@exemplo.com');
  assert.equal(user?.mustChange, 1);
});
test('fixtures de tenants nunca são criadas automaticamente em produção', () => {
  assert.equal(shouldSeedSampleTenants({ NODE_ENV: 'production' }), false);
  assert.equal(shouldSeedSampleTenants({ NODE_ENV: 'production', VIGIA_SEED_SAMPLE_TENANTS: '1' }), false);
  assert.equal(shouldSeedSampleTenants({ NODE_ENV: 'development', VIGIA_SEED_SAMPLE_TENANTS: '1' }), true);
  assert.equal(shouldSeedSampleTenants({ DEMO_MODE: '1' }), true);
});
test('pipeline não pode conter limpeza global destrutiva de menções', () => {
  const source = readFileSync(new URL('../lib/pipeline.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /DELETE\s+FROM\s+mentions/i);
});
