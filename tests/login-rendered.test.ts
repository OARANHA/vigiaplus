import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoginForm } from '../components/login-form';

test('login em português tem ação e nomes acessíveis dos campos traduzidos', () => {
  const props = { locale: 'pt' as const };
  const html = renderToStaticMarkup(createElement(LoginForm, props));
  assert.ok(html.includes('Entrar'));
  assert.ok(html.includes('aria-label="E-mail profissional"'));
  assert.ok(html.includes('aria-label="Senha"'));
});
