// ---------------------------------------------------------------------------
// Ponte entre o LLM Registry (multi-tenant) e o sistema de IA legado do crises.
//
// O crises original usa lib/ai-provider.ts com AiProviderId fixo (anthropic,
// openai, grok, azure) e chaves em env/meta. O VigiaPlus adiciona o LLM
// Registry (lib/tenant/llm-registry.ts) com provedores como linhas no banco,
// qualquer endpoint OpenAI-compatible, validacao SSRF e cota por tenant.
//
// Esta ponte resolve o provedor ativo consultando primeiro o registry.
// Se houver um provedor global habilitado no banco, ele vence.
// Senao, cai para o sistema legado (env/meta) — compatibilidade total.
// ---------------------------------------------------------------------------

import { eq, and } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { llmProviders } from '@/lib/db/schema';
import { resolveTenantContext, type TenantContext } from '@/lib/tenant/context';

export type ResolvedProvider = {
  source: 'registry' | 'legacy';
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
};

/**
 * Resolve o provedor LLM ativo para a chamada atual.
 *
 * Ordem de precedencia:
 *   1. Registry: se houver um provedor global enabled no banco, usa ele.
 *   2. Legacy: cai para aiProvider()/providerKey() do sistema original.
 *
 * O tenant context e resolvido da sessao (nunca do request), mas se nao houver
 * sessao (ex.: cron job sem surface), usa o provedor global sem contexto de tenant.
 */
export async function resolveActiveProvider(opts: { ctx?: TenantContext; purpose?: string } = {}): Promise<ResolvedProvider> {
  // Tentar via registry primeiro
  const db = await getDb();
  const [registryProvider] = await db.select().from(llmProviders)
    .where(and(eq(llmProviders.scope, 'global'), eq(llmProviders.enabled, 1)))
    .limit(1);

  if (registryProvider) {
    const apiKey = resolveApiKey(registryProvider.apiKeyRef);
    return {
      source: 'registry',
      id: registryProvider.id,
      name: registryProvider.name,
      baseUrl: registryProvider.baseUrl,
      apiKey: apiKey ?? undefined,
      model: registryProvider.model,
    };
  }

  // Fallback: sistema legado (env/meta)
  const { aiProvider, providerKey, providerEndpoint, AI_PROVIDERS, aiModels } = await import('@/lib/ai-provider');
  const legacyId = await aiProvider();
  const key = await providerKey(legacyId);
  const endpoint = await providerEndpoint(legacyId);
  const def = AI_PROVIDERS[legacyId];
  const models = await aiModels(legacyId);

  return {
    source: 'legacy',
    id: legacyId,
    name: def.label,
    baseUrl: endpoint ?? '',
    apiKey: key,
    model: models.smart,
  };
}

function resolveApiKey(ref: string): string | null {
  if (typeof ref === 'string' && ref.startsWith('ENV:')) {
    return process.env[ref.slice(4)] ?? null;
  }
  return null;
}

/**
 * Verifica se ha algum provedor LLM configurado (registry ou legacy).
 */
export async function llmAvailable(): Promise<boolean> {
  const db = await getDb();
  const [registryProvider] = await db.select().from(llmProviders)
    .where(and(eq(llmProviders.scope, 'global'), eq(llmProviders.enabled, 1)))
    .limit(1);
  if (registryProvider) {
    const key = resolveApiKey(registryProvider.apiKeyRef);
    return Boolean(key);
  }
  // Fallback legacy
  const { aiProvider, providerKey } = await import('@/lib/ai-provider');
  return Boolean(await providerKey(await aiProvider()));
}

/**
 * Resolve o contexto de tenant para chamadas de IA.
 * Retorna null se nao houver sessao (ex.: cron job) — o que e OK para
 * provedores globais, mas callProvider do registry exigira tenant para cota.
 */
export async function resolveAiContext(): Promise<TenantContext | null> {
  try {
    return await resolveTenantContext({ surface: 'analyst' });
  } catch {
    return null;
  }
}
