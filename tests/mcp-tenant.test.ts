import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MCP_TOKEN_ENV, MCP_TOOLS, tokenHash, tokenMatches, scopeFilter, projectScope,
  checkRateLimit,
} from '../lib/mcp';

// ---------------------------------------------------------------------------
// MCP por tenant: o que dá para provar SEM banco (hash, escopo, rate limit).
// resolveMcpTenant() toca o banco e fica coberto pela integração/E2E; aqui
// isolamos as partes puras que decidem o vazamento entre tenants.
// ---------------------------------------------------------------------------

test('tokenHash é SHA-256 hex, determinístico e nunca o token em claro', () => {
  const expected = createHash('sha256').update('segredo').digest('hex');
  assert.equal(tokenHash('segredo'), expected);
  assert.match(tokenHash('segredo'), /^[0-9a-f]{64}$/);
  assert.equal(tokenHash('segredo'), tokenHash('segredo'));
  assert.notEqual(tokenHash('segredo'), tokenHash('outro'));
  assert.notEqual(tokenHash('segredo'), 'segredo');
});

test('tokenMatches compara em tempo constante sem aceitar prefixos', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abc', 'abd'), false);
  assert.equal(tokenMatches('ab', 'abc'), false);
  assert.equal(tokenMatches(null, 'abc'), false);
  assert.equal(tokenMatches('abc', ''), false);
});

test('scopeFilter(0) é system e não filtra; tenant real filtra por tenantId', () => {
  const system = scopeFilter(0);
  assert.equal(system.system, true);
  assert.equal(system.filterTenantId, null);

  const client = scopeFilter(7);
  assert.equal(client.system, false);
  assert.equal(client.tenantId, 7);
  assert.equal(client.filterTenantId, 7);

  assert.equal(scopeFilter(42).filterTenantId, 42);
});

test('projectScope devolve sem filtro para system e uma condição para tenant', () => {
  assert.equal(projectScope(0), undefined);
  assert.ok(projectScope(7), 'tenant deve receber eq(projects.tenantId, 7)');
});

test('checkRateLimit respeita o máximo na janela de 60s e reseta depois', () => {
  const key = `test-${Date.now()}-a`;
  const now = 1_000_000;
  assert.equal(checkRateLimit(key, 2, now), true);
  assert.equal(checkRateLimit(key, 2, now + 1), true);
  assert.equal(checkRateLimit(key, 2, now + 2), false, '3ª chamada estoura o limite');
  assert.equal(checkRateLimit(key, 2, now + 59_999), false, 'ainda dentro da janela');
  assert.equal(checkRateLimit(key, 2, now + 60_000), true, 'nova janela libera');
});

test('checkRateLimit isola chaves (tokens) diferentes', () => {
  const now = 2_000_000;
  const a = `test-${Date.now()}-b`;
  const b = `test-${Date.now()}-c`;
  assert.equal(checkRateLimit(a, 1, now), true);
  assert.equal(checkRateLimit(a, 1, now), false);
  assert.equal(checkRateLimit(b, 1, now), true, 'outro token tem cota própria');
});

test('o fallback global e o catálogo de ferramentas continuam intactos', () => {
  assert.equal(MCP_TOKEN_ENV, 'RADAR_MCP_TOKEN');
  assert.equal(MCP_TOOLS.length, 11);
  assert.equal(new Set(MCP_TOOLS.map((t) => t.name)).size, MCP_TOOLS.length);
});
