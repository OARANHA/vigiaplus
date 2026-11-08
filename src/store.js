// Store em memória para a fundação. Em produção, a MESMA regra vira
// Row-Level Security do Postgres com `SET LOCAL app.tenant_id = ...`.
//
// Regras que este arquivo torna impossíveis de burlar:
//  1. Toda tabela com dado de cliente exige tenantId no contexto (A2).
//  2. O tenant_id de um INSERT é SEMPRE o do contexto; o que vem do request
//     é ignorado (A1 — tenant forjado).
//  3. Buscar por id de outro tenant devolve null, não 403 (A3 — sem vazamento
//     de existência).
import { err } from './errors.js';
import { FEATURE_CATALOG, PLANS, PLAN_FEATURES } from './catalog.js';

const TABLES = [
  'tenants', 'users', 'sessions', 'memberships',
  'feature_catalog', 'plans', 'plan_features',
  'tenant_features', 'subscriptions', 'invoices',
  'reputation_targets', 'incidents', 'mentions',
  'llm_providers', 'llm_routes', 'llm_usage',
  'payment_events', 'audit_events', 'notification_channels',
  'mcp_tokens', 'api_keys', 'alert_rules', 'invitations',
];

// Tabelas de catálogo não contêm dado de cliente. Todas as demais são escopadas.
const GLOBAL_TABLES = new Set([
  'tenants', 'users', 'sessions',
  'feature_catalog', 'plans', 'plan_features',
  'llm_providers', 'llm_routes',
]);
const TENANT_SCOPED = new Set(TABLES.filter((t) => !GLOBAL_TABLES.has(t)));

export function createStore() {
  const tables = Object.fromEntries(TABLES.map((t) => [t, []]));
  let seq = 1000;
  const nextId = () => ++seq;

  const insertRaw = (table, row) => {
    if (!tables[table]) throw new Error(`Tabela desconhecida: ${table}`);
    tables[table].push(row);
    return row;
  };
  const allRaw = (table) => (tables[table] ?? []).slice();
  const findRaw = (table, pred) => (tables[table] ?? []).find(pred) ?? null;

  function all(table, ctx) {
    if (!ctx) throw err.scope('Contexto ausente na consulta');
    if (!GLOBAL_TABLES.has(table)) {
      if (ctx.system !== true && !ctx.tenantId) {
        throw err.scope(`Consulta em "${table}" sem tenant_id no contexto`);
      }
    }
    const rows = allRaw(table);
    if (GLOBAL_TABLES.has(table) || ctx.system === true) return rows;
    return rows.filter((r) => String(r.tenant_id) === String(ctx.tenantId));
  }

  function find(table, ctx, id) {
    return all(table, ctx).find((r) => String(r.id) === String(id)) ?? null;
  }

  function insert(table, row, ctx) {
    if (!TENANT_SCOPED.has(table)) {
      return insertRaw(table, { id: row.id ?? nextId(), ...row });
    }
    if (ctx.system !== true && !ctx.tenantId) {
      throw err.scope(`Escrita em "${table}" sem tenant_id no contexto`);
    }
    // A1: o tenant_id do payload é descartado. Vale o do contexto autenticado.
    return insertRaw(table, {
      ...row,
      id: row.id ?? nextId(),
      tenant_id: ctx.tenantId ?? null,
    });
  }

  return {
    tables, TENANT_SCOPED, GLOBAL_TABLES,
    insertRaw, allRaw, findRaw, all, find, insert, nextId,
  };
}

export function seedStore(store) {
  const T = store.insertRaw;

  // --- tenants -------------------------------------------------------------
  T('tenants', { id: 1, name: 'Aurora Mobility', slug: 'aurora', domain: 'vigia.aurora.com.br', plan_key: 'empresa', status: 'active' });
  T('tenants', { id: 2, name: 'Grupo Boreal', slug: 'boreal', domain: 'vigia.boreal.com.br', plan_key: 'padrao', status: 'active' });
  T('tenants', { id: 3, name: 'Clínica Vereda', slug: 'vereda', domain: null, plan_key: 'padrao', status: 'active' });

  // --- usuários e sessões SERVER-SIDE (token -> sessão; nunca vem do request)
  T('users', { id: 1, name: 'Dono', email: 'owner@vigiaplus.local', global_role: 'owner', status: 'active' });
  T('users', { id: 2, name: 'Rafael (analista)', email: 'rafael@vigiaplus.local', global_role: 'analyst', status: 'active' });
  T('users', { id: 3, name: 'Marina Costa', email: 'marina@aurora.com.br', global_role: null, status: 'active' });
  T('users', { id: 4, name: 'Carlos Mendes', email: 'carlos@aurora.com.br', global_role: null, status: 'active' });
  T('users', { id: 5, name: 'Helena Prado', email: 'helena@boreal.com.br', global_role: null, status: 'active' });

  T('sessions', { token: 's-owner', userId: 1, tenantId: null });
  T('sessions', { token: 's-analyst', userId: 2, tenantId: 1 });
  T('sessions', { token: 's-aurora-admin', userId: 3, tenantId: 1 });
  T('sessions', { token: 's-aurora-view', userId: 4, tenantId: 1 });
  T('sessions', { token: 's-boreal-admin', userId: 5, tenantId: 2 });
  T('sessions', { token: 's-revogada', userId: 3, tenantId: 1, revoked: true });

  T('memberships', { id: 1, tenant_id: 1, user_id: 3, role: 'client_admin' });
  T('memberships', { id: 2, tenant_id: 1, user_id: 4, role: 'client_viewer' });
  T('memberships', { id: 3, tenant_id: 2, user_id: 5, role: 'client_admin' });

  // --- catálogo e planos ---------------------------------------------------
  for (const f of FEATURE_CATALOG) T('feature_catalog', { ...f });
  for (const p of PLANS) T('plans', { ...p });
  for (const [plan, keys] of Object.entries(PLAN_FEATURES)) {
    for (const k of keys) T('plan_features', { plan_key: plan, feature_key: k });
  }

  T('subscriptions', { id: 1, tenant_id: 1, plan_key: 'empresa', status: 'active' });
  T('subscriptions', { id: 2, tenant_id: 2, plan_key: 'padrao', status: 'active' });
  T('subscriptions', { id: 3, tenant_id: 3, plan_key: 'padrao', status: 'active' });

  // Overrides por contrato: Boreal não comprou playbook de IA.
  T('tenant_features', { id: 1, tenant_id: 2, feature_key: 'crisis_playbook', enabled: false, reason: 'contrato sem módulo de IA', expires_at: null });
  // Override temporário: Aurora participa do piloto de busca semântica.
  T('tenant_features', { id: 2, tenant_id: 1, feature_key: 'semantic_search', enabled: true, reason: 'piloto controlado', expires_at: '2099-01-01T00:00:00.000Z' });
  // Override expirado: não deve liberar nada.
  T('tenant_features', { id: 3, tenant_id: 1, feature_key: 'mcp_access', enabled: true, reason: 'beta encerrado', expires_at: '2000-01-01T00:00:00.000Z' });

  // --- dados de domínio ----------------------------------------------------
  T('reputation_targets', { id: 1, tenant_id: 1, kind: 'brand', name: 'Aurora Mobility', score: 72 });
  T('reputation_targets', { id: 2, tenant_id: 1, kind: 'market', name: 'Setor de mobilidade urbana', score: 64 });
  T('reputation_targets', { id: 3, tenant_id: 2, kind: 'brand', name: 'Grupo Boreal', score: 81 });
  T('reputation_targets', { id: 4, tenant_id: 2, kind: 'market', name: 'Setor de energia', score: 70 });
  T('incidents', { id: 482, tenant_id: 1, title: 'Aumento de comentários sobre atendimento', status: 'monitoring', severity: 'low', owner: 'analista@vigia' });
  T('incidents', { id: 991, tenant_id: 2, title: 'Ruptura de fornecedor', status: 'closed', severity: 'high', owner: 'analista@vigia' });
  T('mentions', { id: 1, tenant_id: 1, source: 'Google News', content: 'Reportagem sobre filas no atendimento' });
  T('mentions', { id: 2, tenant_id: 2, source: 'Reddit', content: 'Discussão sobre fornecedor' });

  // --- LLM: provedores são DADOS, não um union type ------------------------
  T('llm_providers', { id: 'openai', name: 'OpenAI', base_url: 'https://api.openai.com/v1', api_key_ref: 'ENV:OPENAI_API_KEY', model: 'gpt-4o-mini', enabled: true, scope: 'global' });
  T('llm_providers', { id: 'azure', name: 'Azure OpenAI', base_url: 'https://vigiaplus.openai.azure.com/v1', api_key_ref: 'ENV:AZURE_API_KEY', model: 'gpt-4o', enabled: true, scope: 'global' });
  T('llm_routes', { id: 1, purpose: 'classification', provider_id: 'openai', priority: 0 });
  T('llm_routes', { id: 2, purpose: 'playbook', provider_id: 'azure', priority: 0 });

  const now = new Date().toISOString();
  T('llm_usage', { id: 1, tenant_id: 1, purpose: 'classification', cost_brl: 38, tokens: 120000, at: now });
  T('llm_usage', { id: 2, tenant_id: 2, purpose: 'playbook', cost_brl: 46, tokens: 90000, at: now });

  T('notification_channels', { id: 1, tenant_id: 1, channel: 'whatsapp', destination: 'Marina Costa', active: true });
  T('notification_channels', { id: 2, tenant_id: 1, channel: 'email', destination: 'marina@aurora.com.br', active: true });
  T('notification_channels', { id: 3, tenant_id: 2, channel: 'email', destination: 'helena@boreal.com.br', active: true });

  T('mcp_tokens', { id: 'tk_aurora', tenant_id: 1, token: 'tk_aur_8f2c', scopes: ['get_reputation', 'list_incidents'], rate_limit: 60, active: true });
  T('mcp_tokens', { id: 'tk_boreal', tenant_id: 2, token: 'tk_bor_1a90', scopes: ['get_reputation'], rate_limit: 60, active: true });

  T('invoices', { id: 1, tenant_id: 1, amount_brl: 1790, status: 'paid', due_at: '2026-11-02' });
  T('invoices', { id: 2, tenant_id: 2, amount_brl: 590, status: 'paid', due_at: '2026-11-10' });

  return store;
}

export function freshStore() {
  return seedStore(createStore());
}
