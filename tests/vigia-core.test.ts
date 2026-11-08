import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalArticleUrl, classifyEntities, discardReason, safeSourceError,
  validateSourceIds } from '../lib/vigia/core';
import type { RawMention } from '../lib/connectors/types';

const base: RawMention = {
  source: 'gdelt', externalId: 'https://jornal.example/reportagem',
  url: 'https://jornal.example/reportagem', title: 'CRF-RS discute fiscalização',
  content: 'Conselho Regional de Farmácia do Rio Grande do Sul',
  publishedAt: new Date(),
};

test('entidades verificadas: Giovana, funcionários e instituição podem coexistir', () => {
  const keys = classifyEntities({
    title: 'Giovana Ranquetat Fernandes fala sobre CRF-RS',
    content: 'FuncionariosCRFRS publicou uma manifestação',
    url: undefined,
  });
  assert.deepEqual(keys.sort(), ['crfrs', 'funcionarios', 'giovana']);
});

test('termo genérico farmácia ou funcionário não identifica o CRF-RS', () => {
  assert.deepEqual(classifyEntities({
    title: 'Funcionário de farmácia reivindica melhoria',
    content: 'Notícia sobre uma empresa privada',
    url: 'https://exemplo.com/artigo',
  }), []);
});

test('apelido no domínio e variações escritas da sigla são reconhecidos', () => {
  assert.deepEqual(classifyEntities({
    title: 'Nova diretriz',
    content: 'Confira o Conselho Regional de Farmácia do RS',
    url: 'https://crfrs.org.br/noticias/nova-diretriz',
  }), ['crfrs']);
});

test('canonicalização remove rastreadores sem remover parâmetros editoriais', () => {
  const a = canonicalArticleUrl('https://WWW.Example.com/a/?utm_source=feed&id=42&fbclid=abc#heading');
  const b = canonicalArticleUrl('https://example.com/a?id=42');
  assert.equal(a, b);
  assert.notEqual(a, canonicalArticleUrl('https://example.com/a?id=43'));
});

test('canonicalização recusa javascript, usuários embutidos e entrada inválida', () => {
  assert.equal(canonicalArticleUrl('javascript:alert(1)'), null);
  assert.equal(canonicalArticleUrl('https://user:secret@example.com/path'), null);
  assert.equal(canonicalArticleUrl('não é url'), null);
});

test('fontes habilitadas seguem allowlist e nunca incluem conectores premium', () => {
  assert.deepEqual(validateSourceIds(['gdelt', 'instagram', 'googlenews', 'gdelt', 'rss']),
    ['gdelt', 'googlenews', 'rss']);
  assert.deepEqual(validateSourceIds(null), []);
});

test('rejeita item antigo, sem URL ou sem entidade; não fabrica uma notícia', () => {
  assert.equal(discardReason(base), null);
  assert.equal(discardReason({ ...base, title: 'Notícia de farmácia', content: '' }),
    'sem_entidade_verificada');
  assert.equal(discardReason({ ...base, url: undefined }), 'sem_identificador_ou_url');
  assert.equal(discardReason({ ...base, publishedAt: new Date('2020-01-01') }), 'fora_da_janela');
});

test('erro de fonte preserva HTTP mas mascara URL e credenciais', () => {
  const error = safeSourceError(new Error('HTTP 429 em https://api.example.com/keys?token=secret'));
  assert.equal(error.httpStatus, 429);
  assert.ok(!error.message.includes('secret'));
  assert.ok(!error.message.includes('api.example.com'));
});
