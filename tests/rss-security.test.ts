import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRssUrl, assertRssDnsPublic, isUnsafeHost } from '../lib/connectors/safe-rss';

test('RSS rejeita host privado, loopback e metadados IPv4/IPv6', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.0.8', '172.31.0.9',
    '192.168.1.1', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]',
    'metadata.google.internal', 'intranet.internal']) {
    assert.ok(isUnsafeHost(host), `deveria bloquear ${host}`);
  }
});
test('RSS exige HTTPS e allowlist exata em produção', () => {
  assert.throws(() => assertRssUrl('http://news.example/rss', ['news.example'], true), /protocolo/);
  assert.throws(() => assertRssUrl('https://evil.news.example/rss', ['news.example'], true), /allowlist/);
  assert.throws(() => assertRssUrl('https://user:pwd@news.example/rss', ['news.example'], true), /credenciais/);
  assert.throws(() => assertRssUrl('https://news.example:8080/rss', ['news.example'], true), /porta/);
  assert.equal(assertRssUrl('https://news.example/rss', ['news.example'], true).hostname, 'news.example');
});
test('RSS bloqueia resolução DNS que inclua IP privado, mesmo com hostname permitido', async () => {
  const safe = assertRssUrl('https://news.example/rss', ['news.example'], true);
  await assert.rejects(() => assertRssDnsPublic(safe, async () => ['203.0.113.2', '127.0.0.1']), /privado/);
  await assert.doesNotReject(() => assertRssDnsPublic(safe, async () => ['8.8.8.8']));
});
