import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loginLimitKeys, loginBlockRemainingSeconds, recordFailedLogin, clearSuccessfulLogin,
  trustedClientIp, AUTH_ACCOUNT_MAX_FAILURES, AUTH_WINDOW_MS,
} from '../lib/auth-rate-limit';

const dir = mkdtempSync(join(tmpdir(), 'vigiaplus-login-limiter-'));
process.env.PGLITE_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;
let db: Awaited<ReturnType<typeof import('../lib/db')['getDb']>>;
before(async () => { db = await (await import('../lib/db')).getDb(); });
after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }));

test('identidade de login normalizada e nunca gravada em claro', () => {
  const headers = new Headers();
  const a = loginLimitKeys('  OP@Example.org  ', headers, false);
  const b = loginLimitKeys('op@example.org', headers, false);
  assert.deepEqual(a, b);
  assert.match(a[0].hash, /^[0-9a-f]{64}$/);
  assert.ok(!a[0].hash.includes('example.org'));
});
test('proxy não confiável não aceita X-Forwarded-For controlado pelo cliente', () => {
  const h = new Headers({ 'x-forwarded-for': '10.0.0.5, 203.0.113.4' });
  assert.equal(trustedClientIp(h, false), null);
  assert.equal(trustedClientIp(h, true), '203.0.113.4');
  assert.equal(loginLimitKeys('a@example.org', h, false).length, 1);
  assert.equal(loginLimitKeys('a@example.org', h, true).length, 2);
});
test('tentativas falhas bloqueiam conta com contador compartilhável no banco e liberam após janela', async () => {
  const key = loginLimitKeys('locked@example.org', new Headers(), false);
  const now = new Date('2026-11-09T12:00:00Z');
  for (let i = 0; i < AUTH_ACCOUNT_MAX_FAILURES; i++) {
    await recordFailedLogin(db, key, now);
  }
  const blocked = await loginBlockRemainingSeconds(db, key, now);
  assert.ok(blocked > 0);
  assert.equal(await loginBlockRemainingSeconds(db, key, new Date(now.getTime() + AUTH_WINDOW_MS + 1000)), 0);
  await recordFailedLogin(db, key, new Date(now.getTime() + AUTH_WINDOW_MS + 1000));
  assert.equal(await loginBlockRemainingSeconds(db, key, new Date(now.getTime() + AUTH_WINDOW_MS + 1000)), 0);
});
test('sucesso limpa bloqueio da conta, sem apagar estatísticas de rede', async () => {
  const key = loginLimitKeys('clear@example.org', new Headers(), false);
  const now = new Date('2026-11-09T13:00:00Z');
  for (let i = 0; i < AUTH_ACCOUNT_MAX_FAILURES; i++) await recordFailedLogin(db, key, now);
  assert.ok(await loginBlockRemainingSeconds(db, key, now) > 0);
  await clearSuccessfulLogin(db, 'clear@example.org');
  assert.equal(await loginBlockRemainingSeconds(db, key, now), 0);
});
