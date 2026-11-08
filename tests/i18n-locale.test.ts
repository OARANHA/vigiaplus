import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICT, LOCALES, localeTag, tFor } from '../lib/i18n-dict';
import { localeDirective, kpiLang } from '../lib/content-locale';

// ---------------------------------------------------------------------------
// Português (BR) como locale de primeira classe (Incremento 1 do roadmap).
// A paridade de chaves com o italiano é o contrato que garante que a UI em
// pt-BR não fica pela metade: se uma chave entra no dicionário IT, precisa
// entrar também no PT (o fallback é o inglês, mas metade traduzida parece
// um bug para quem lê a página).
// ---------------------------------------------------------------------------

test('pt-BR está registrado no seletor de idiomas com bandeira e rótulo', () => {
  const pt = LOCALES.find((l) => l.code === 'pt');
  assert.ok(pt, 'locale pt deve existir em LOCALES');
  assert.equal(pt.flag, '🇧🇷');
  assert.equal(pt.label, 'Português (BR)');
});

test('o dicionário pt cobre exatamente as mesmas chaves do italiano', () => {
  const itKeys = Object.keys(DICT.it).sort();
  const ptKeys = Object.keys(DICT.pt).sort();
  assert.deepEqual(ptKeys, itKeys, 'PT deve ter paridade de chaves com IT');
  for (const k of itKeys) {
    assert.ok(typeof DICT.pt[k] === 'string' && DICT.pt[k].length > 0, `chave ${k} vazia em PT`);
  }
});

test('tFor("pt") traduz e mantém o fallback em inglês para chaves ausentes', () => {
  const t = tFor('pt');
  assert.equal(t('nav.listening', 'Listening'), 'Escuta');
  assert.equal(t('ui.export', 'Export'), 'Exportar');
  assert.equal(t('chave.que.nao.existe', 'Fallback text'), 'Fallback text');
});

test('localeTag mapeia pt → pt-BR, it → it-IT, en → en-US (datas)', () => {
  assert.equal(localeTag('pt'), 'pt-BR');
  assert.equal(localeTag('it'), 'it-IT');
  assert.equal(localeTag('en'), 'en-US');
});

test('directiva de conteúdo da IA pede "Brazilian Portuguese" e preserva enums em inglês', () => {
  const d = localeDirective('pt');
  assert.match(d, /Brazilian Portuguese/);
  assert.match(d, /Keep all JSON keys/);
  assert.equal(localeDirective('en'), '');
  assert.match(localeDirective('it'), /Italian/);
});

test('as notas de KPI agora chegam em pt-BR (tradução completa pós-audit)', () => {
  assert.equal(kpiLang('pt'), 'pt');
  assert.equal(kpiLang('it'), 'it');
  assert.equal(kpiLang('en'), 'en');
});

test('nenhuma tradução pt é cópia do identificador da chave (sanidade do dicionário)', () => {
  for (const [k, v] of Object.entries(DICT.pt)) {
    assert.notEqual(v, k, `valor de ${k} igual à chave — tradução faltando`);
  }
});
