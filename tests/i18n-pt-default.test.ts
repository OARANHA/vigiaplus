import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DICT, LOCALES, DEFAULT_LOCALE, normalizeLocale, tFor,
} from '../lib/i18n-dict';

// ---------------------------------------------------------------------------
// ADR-08: pt-BR é o locale padrão da frente H5. Sem cookie a interface inicia
// em português; os três locales explícitos continuam valendo. A paridade de
// chaves PT<->IT é o contrato que impede uma UI pt "pela metade".
// ---------------------------------------------------------------------------

test('ADR-08: DEFAULT_LOCALE é pt', () => {
  assert.equal(DEFAULT_LOCALE, 'pt');
  assert.ok(LOCALES.some((l) => l.code === 'pt'), 'pt continua registrado no seletor');
});

test('sem cookie (ou valor inválido) o locale resolvido é pt', () => {
  assert.equal(normalizeLocale(undefined), 'pt');
  assert.equal(normalizeLocale(null), 'pt');
  assert.equal(normalizeLocale(''), 'pt');
  assert.equal(normalizeLocale('fr'), 'pt');
});

test('it / pt / en explícitos continuam válidos', () => {
  assert.equal(normalizeLocale('it'), 'it');
  assert.equal(normalizeLocale('pt'), 'pt');
  assert.equal(normalizeLocale('en'), 'en');
});

test('tFor("pt") usa o dicionário pt e preserva o fallback inglês', () => {
  const t = tFor('pt');
  assert.equal(t('h5.settings.back', '← back'), '← voltar');
  assert.equal(t('h5.settings.twNoticeB', '10 credits per call'), '10 créditos por chamada mais 1 por resultado');
  assert.equal(t('h5.chave.inexistente', 'fallback inglês'), 'fallback inglês');
});

test('paridade exata de chaves PT<->IT após as chaves H5', () => {
  const itKeys = Object.keys(DICT.it).sort();
  const ptKeys = Object.keys(DICT.pt).sort();
  assert.deepEqual(ptKeys, itKeys);
  for (const k of itKeys) {
    assert.ok(DICT.pt[k].length > 0, `chave ${k} vazia em PT`);
    assert.notEqual(DICT.pt[k], k, `valor de ${k} igual à chave — tradução faltando`);
  }
});
