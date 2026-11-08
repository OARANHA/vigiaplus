import test from 'node:test';
import assert from 'node:assert/strict';
import { freshStore, createStore, seedStore } from '../src/store.js';
import { resolveContext, switchTenant } from '../src/context.js';
import { can, requireSurface, requireAction } from '../src/rbac.js';
import { featureState, requireFeature, enabledFeatures, setTenantFeature } from '../src/entitlements.js';
import { registerProvider, listProviders, validateEndpoint, buildChatRequest, checkQuota } from '../src/llm-registry.js';
import { signWebhook, verifyWebhook, processPaymentEvent, createGateway, StripeAdapter } from '../src/payments.js';
import { createApp, createServer } from '../src/server.js';

async function withServer(fn) {
  const app = createApp();
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('store: seed consistente', () => {
  const store = freshStore();
  assert.equal(store.allRaw('tenants').length, 3);
  assert.equal(store.allRaw('llm_providers').length, 2);
  assert.equal(store.allRaw('feature_catalog').length, 13);
});

test('store: leitura escopada devolve só o tenant do contexto', () => {
  const store = freshStore();
  const ctx = resolveContext(store, { sessionToken: 's-aurora-admin', surface: 'app' });
  const targets = store.all('reputation_targets', ctx);
  assert.equal(targets.length, 2);
  assert.ok(targets.every((t) => t.tenant_id === 1));
});

test('store: insert ignora tenant_id forjado no payload', () => {
  const store = freshStore();
  const ctx = resolveContext(store, { sessionToken: 's-aurora-admin', surface: 'app' });
  const row = store.insert('incidents', { tenant_id: 2, title: 'teste' }, ctx);
  assert.equal(row.tenant_id, 1);
});

test('RBAC: owner tem tudo; client_viewer só lê', () => {
  const owner = { role: 'owner' };
  assert.equal(can(owner, 'qualquer_coisa'), true);
  assert.equal(can({ role: 'client_viewer' }, 'read'), true);
  assert.equal(can({ role: 'client_viewer' }, 'write_preferences'), false);
  assert.throws(() => requireAction({ role: 'client_viewer' }, 'invite'), (e) => e.code === 'FORBIDDEN');
  assert.throws(() => requireSurface({ role: 'client_viewer' }, 'console'), (e) => e.code === 'FORBIDDEN');
  assert.doesNotThrow(() => requireSurface({ role: 'analyst' }, 'analyst'));
});

test('context: sessão revogada é recusada', () => {
  const store = freshStore();
  assert.throws(
    () => resolveContext(store, { sessionToken: 's-revogada', surface: 'app' }),
    (e) => e.code === 'UNAUTHENTICATED',
  );
});

test('context: dono em visão de carteira é system; impersonação exige motivo', () => {
  const store = freshStore();
  const owner = resolveContext(store, { sessionToken: 's-owner', surface: 'console' });
  assert.equal(owner.system, true);
  assert.equal(owner.tenantId, null);
  assert.throws(() => switchTenant(store, owner, 2, ''), (e) => e.code === 'BAD_REQUEST');
  const scoped = switchTenant(store, owner, 2, 'suporte chamado #91');
  assert.equal(scoped.tenantId, 2);
  assert.equal(scoped.system, false);
});

test('entitlements: plano, override desabilitado e override expirado', () => {
  const store = freshStore();
  const aurora = resolveContext(store, { sessionToken: 's-aurora-admin', surface: 'app' });
  assert.equal(featureState(store, aurora, 'reports_monthly').enabled, true);
  assert.equal(featureState(store, aurora, 'semantic_search').source, 'override');
  assert.equal(featureState(store, aurora, 'mcp_access').enabled, false, 'override expirado não libera');

  const boreal = resolveContext(store, { sessionToken: 's-boreal-admin', surface: 'app' });
  assert.throws(
    () => requireFeature(store, boreal, 'crisis_playbook'),
    (e) => e.code === 'FEATURE_DISABLED',
  );
  assert.ok(enabledFeatures(store, boreal).length > 0);
});

test('entitlements: override administrativo exige motivo e é auditado', () => {
  const store = freshStore();
  const owner = resolveContext(store, { sessionToken: 's-owner', surface: 'console' });
  assert.throws(
    () => setTenantFeature(store, owner, 1, { feature_key: 'api_access', enabled: false, reason: '' }),
    (e) => e.code === 'BAD_REQUEST',
  );
  const before = store.allRaw('audit_events').length;
  setTenantFeature(store, owner, 1, { feature_key: 'api_access', enabled: false, reason: 'downgrade contratual' });
  assert.equal(store.allRaw('audit_events').length, before + 1);
});

test('LLM registry: cadastrar provedor novo sem editar código', () => {
  const store = freshStore();
  const owner = resolveContext(store, { sessionToken: 's-owner', surface: 'console' });
  const provider = registerProvider(store, owner, {
    name: 'Groq Cloud',
    base_url: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    api_key_ref: 'ENV:GROQ_API_KEY',
  });
  assert.equal(provider.id, 'groq-cloud');
  assert.equal(listProviders(store).length, 3);
  assert.equal(provider.api_key, undefined, 'chave nunca é persistida');
});

test('LLM registry: cadastro rejeita chave em texto claro', () => {
  const store = freshStore();
  const owner = resolveContext(store, { sessionToken: 's-owner', surface: 'console' });
  assert.throws(
    () => registerProvider(store, owner, {
      name: 'X', base_url: 'https://api.example.com/v1', model: 'm', api_key: 'sk-segredo',
    }),
    (e) => e.code === 'BAD_REQUEST',
  );
});

test('LLM registry: validateEndpoint aceita HTTPS público', () => {
  assert.equal(validateEndpoint('https://api.openai.com/v1').ok, true);
  assert.equal(validateEndpoint('https://openrouter.ai/api/v1').ok, true);
});

test('LLM registry: buildChatRequest separa sistema de dado não confiável', () => {
  const req = buildChatRequest(
    { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini', api_key_ref: 'ENV:X' },
    { system: 'Resuma o sentimento', untrusted: 'Texto coletado', maxTokens: 99999 },
  );
  assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(req.body.max_tokens, 4096, 'teto de tokens é fixo no servidor');
  assert.equal(req.body.messages.length, 2);
  assert.match(req.body.messages[0].content, /Regras imutáveis/);
  assert.match(req.body.messages[1].content, /<dados_coletados/);
});

test('cota: usado + estimado não pode passar o teto do plano', () => {
  const store = freshStore();
  const boreal = resolveContext(store, { sessionToken: 's-boreal-admin', surface: 'app' });
  const q = checkQuota(store, boreal, 4);
  assert.equal(q.ok, true);
  assert.equal(q.quota, 50);
  assert.throws(() => checkQuota(store, boreal, 10), (e) => e.code === 'QUOTA_EXCEEDED');
});

test('pagamentos: assinatura HMAC e normalização do adaptador', () => {
  const raw = '{"id":"evt_1"}';
  const sig = signWebhook(raw, 'segredo');
  assert.equal(verifyWebhook(raw, sig, 'segredo'), true);
  assert.equal(verifyWebhook(raw, 'errado', 'segredo'), false);
  const gateway = createGateway(StripeAdapter);
  const event = gateway.normalize({
    id: 'evt_1',
    type: 'invoice.payment_succeeded',
    data: { object: { metadata: { tenant_id: 2 }, amount_paid: 59000 } },
  });
  assert.equal(event.type, 'payment.succeeded');
  assert.equal(event.tenant_id, 2);
});

test('createStore + seedStore são equivalentes a freshStore', () => {
  const store = seedStore(createStore());
  assert.equal(store.allRaw('tenants').length, 3);
});

test('HTTP: /health responde sem autenticação', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.surfaces, ['app', 'console', 'analyst']);
  });
});

test('HTTP: /api/app/summary exibe valor percebido no modo básico', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/app/summary`, {
      headers: { 'x-vigia-session': 's-aurora-admin' },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.reputations.length, 2);
    assert.equal(body.work_evidence.sources_monitored, 24);
    assert.equal(body.view.density, 'basico');
  });
});

test('HTTP: rota de console é negada para cliente', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/console/tenants`, {
      headers: { 'x-vigia-session': 's-aurora-admin' },
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'FORBIDDEN');
  });
});

test('HTTP: cliente cadastra provedor? não — 403', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/console/llm-providers`, {
      method: 'POST',
      headers: { 'x-vigia-session': 's-aurora-admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Evil', base_url: 'https://api.example.com/v1', model: 'm' }),
    });
    assert.equal(res.status, 403);
  });
});
