import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickRoutedProvider, providerVisible } from '../lib/tenant/provider-routing';
import { parseChatCompletion } from '../lib/tenant/llm-registry';

const providers = [
  { id: 'global', scope: 'global', tenantId: null, enabled: 1 },
  { id: 'a', scope: 'tenant', tenantId: 10, enabled: 1 },
  { id: 'b', scope: 'tenant', tenantId: 20, enabled: 1 },
  { id: 'disabled', scope: 'global', tenantId: null, enabled: 0 },
];
const routes = [
  { purpose: 'classification', tenantId: null, providerId: 'global', priority: 0 },
  { purpose: 'classification', tenantId: 10, providerId: 'a', priority: 1 },
  { purpose: 'classification', tenantId: 10, providerId: 'b', priority: 0 },
  { purpose: 'classification', tenantId: 20, providerId: 'b', priority: 0 },
  { purpose: 'playbook', tenantId: null, providerId: 'disabled', priority: 0 },
];

test('tenant 10 escolhe somente seu provedor apesar de rota indevida de tenant 20', () => {
  assert.equal(pickRoutedProvider(10, 'classification', providers, routes)?.id, 'a');
  assert.equal(pickRoutedProvider(20, 'classification', providers, routes)?.id, 'b');
  assert.equal(pickRoutedProvider(30, 'classification', providers, routes)?.id, 'global');
  assert.equal(pickRoutedProvider(null, 'classification', providers, routes)?.id, 'global');
});
test('override não pode escolher provedor privado de outro tenant', () => {
  assert.equal(pickRoutedProvider(10, 'classification', providers, routes, 'b'), null);
  assert.equal(pickRoutedProvider(10, 'classification', providers, routes, 'global')?.id, 'global');
  assert.equal(providerVisible(providers[2], null), false);
});
test('purpose sem rota válida não escolhe primeiro provedor global por acidente', () => {
  assert.equal(pickRoutedProvider(10, 'playbook', providers, routes), null);
  assert.equal(pickRoutedProvider(10, 'outro', providers, routes), null);
});
test('resposta OpenAI-compatible utiliza conteúdo e tokens reais', () => {
  assert.deepEqual(parseChatCompletion({
    choices: [{ message: { content: 'Menções classificadas.' } }],
    usage: { prompt_tokens: 12, completion_tokens: 7 },
  }), { content: 'Menções classificadas.', tokensIn: 12, tokensOut: 7 });
  assert.throws(() => parseChatCompletion({ choices: [{ message: { content: null } }] }), /sem conteúdo/);
});
