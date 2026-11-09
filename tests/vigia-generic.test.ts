import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explicitlyMatches, projectQuery, matchingEntityIds, genericDiscardReason } from '../lib/vigia/generic';
import type { RawMention } from '../lib/connectors/types';

const project = {
  keywords: ['Órbita Alfa'], allTerms: [], excludeTerms: ['boato'],
  languages: ['pt'], countries: ['BR'], rssFeeds: [],
};
const entity = { id: 9, name: 'Órbita Alfa', keywords: ['Órbita Alfa', 'Alpha Orbita'] };
const sample: RawMention = {
  source: 'googlenews', externalId: 'abc', url: 'https://jornal.example/materia',
  title: 'Órbita Alfa divulga comunicado', content: 'Foi anunciada uma nova estratégia.',
  publishedAt: new Date(),
};

test('normaliza acentos, respeita fronteiras de palavras e separa clientes', () => {
  assert.equal(explicitlyMatches('A Órbita Alfa decidiu', 'orbita alfa'), true);
  assert.equal(explicitlyMatches('MegaÓrbita Alfabeto', 'orbita alfa'), false);
  assert.equal(genericDiscardReason(sample, project, [entity]), null);
  const otherProject = { ...project, keywords: ['Beta Fluxo'] };
  assert.equal(genericDiscardReason(sample, otherProject, []), 'sem_termo_do_projeto');
  assert.deepEqual(matchingEntityIds(sample, [entity]), [9]);
  assert.deepEqual(matchingEntityIds(sample, [{ ...entity, id: 10, keywords: ['Beta Fluxo'] }]), []);
});
test('nega termos excluídos, dados sem publicação e buscas sem termos', () => {
  assert.equal(genericDiscardReason({ ...sample, content: 'Boato infundado' }, project, [entity]), 'termo_excluido');
  assert.equal(genericDiscardReason({ ...sample, publishedAt: new Date(NaN) }, project, [entity]), 'data_invalida');
  const empty = { ...project, keywords: [] };
  assert.equal(genericDiscardReason(sample, empty, []), 'sem_criterio_de_relevancia');
  assert.ok(projectQuery(project, [entity]).anyTerms.includes('Órbita Alfa'));
});
test('feed RSS explicitamente cadastrado sem keywords é aceito, mas não Google News', () => {
  const rssOnly = { ...project, keywords: [], excludeTerms: [], rssFeeds: ['https://feeds.example/rss'] };
  assert.equal(genericDiscardReason({ ...sample, source: 'rss' }, rssOnly, []), null);
  assert.equal(genericDiscardReason(sample, rssOnly, []), 'sem_criterio_de_relevancia');
});
test('AND precisa estar presente e não admite correspondência parcial', () => {
  const withAll = { ...project, allTerms: ['Rio Grande do Sul'] };
  assert.equal(genericDiscardReason(sample, withAll, [entity]), 'termo_obrigatorio_ausente');
  assert.equal(genericDiscardReason({ ...sample, content: 'No Rio Grande do Sul foi aprovada.' }, withAll, [entity]), null);
});
