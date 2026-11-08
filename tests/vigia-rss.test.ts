import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rss } from '../lib/connectors/rss';
import type { ListeningQuery } from '../lib/connectors/types';

function q(urls: string[], strict = true): ListeningQuery {
  return { anyTerms: [], allTerms: [], excludeTerms: [], languages: ['pt'],
    countries: ['BR'], rssFeeds: urls, strict };
}

test('RSS não consulta feed ausente nem compartilha watchlist entre projetos', async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    const hostname = new URL(url).hostname;
    const xml = '<rss><channel><title>Notícias</title><item><title>CRF-RS ' +
      hostname + '</title><link>https://' + hostname + '/artigo</link><pubDate>' +
      new Date().toUTCString() + '</pubDate></item></channel></rss>';
    return new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  try {
    assert.deepEqual(await rss.fetchMentions(q([])), []);
    const [first, second] = await Promise.all([
      rss.fetchMentions(q(['https://a.example/rss'])),
      rss.fetchMentions(q(['https://b.example/rss'])),
    ]);
    assert.deepEqual(urls.sort(), ['https://a.example/rss', 'https://b.example/rss']);
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.ok(first[0].url?.includes('a.example'));
    assert.ok(second[0].url?.includes('b.example'));
  } finally {
    globalThis.fetch = original;
  }
});

test('RSS estrito diferencia erro de rede de resultado vazio', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('Erro de origem', { status: 503 });
  try {
    await assert.rejects(
      () => rss.fetchMentions(q(['https://indisponivel.example/feed'])), /HTTP 503/,
    );
    const nonStrict = await rss.fetchMentions(q(['https://indisponivel.example/feed'], false));
    assert.deepEqual(nonStrict, [], 'retrocompatibilidade dos conectores anteriores');
  } finally {
    globalThis.fetch = original;
  }
});
