import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MentionBody } from '../components/mention-translate';

for (const [locale, label] of [['pt', 'Português'], ['en', 'English'], ['it', 'Italiano']] as const) {
  test(`SSR: tradução de menção usa locale ${locale}, independente de document.cookie`, () => {
    const props = { id: 1, lang: 'de', url: null, title: 'Example', content: 'Example text', allowTranslate: true, locale };
    const html = renderToStaticMarkup(createElement(MentionBody, props));
    assert.ok(html.includes(`· ${label}`), `expected translation target ${label}`);
  });
}

test('SSR: menção já em português não recebe botão de tradução para português', () => {
  const props = { id: 1, lang: 'pt', url: null, title: 'Título', content: 'Conteúdo', allowTranslate: true, locale: 'pt' as const };
  assert.ok(!renderToStaticMarkup(createElement(MentionBody, props)).includes('<button'));
});
