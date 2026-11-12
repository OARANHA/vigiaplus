import { NextResponse } from 'next/server';
import { resolveActiveProvider, llmAvailable } from '@/lib/llm-bridge';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { listProviders } from '@/lib/tenant/llm-registry';

// GET /api/console/llm-status — status consolidado do motor de IA.
// Mostra: provedor ativo (registry ou legacy), disponibilidade, lista do registry.
export async function GET() {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);

  const [active, available, registry] = await Promise.all([
    resolveActiveProvider({ ctx }),
    llmAvailable(ctx),
    listProviders(ctx),
  ]);

  return NextResponse.json({
    active: {
      source: active.source,
      id: active.id,
      name: active.name,
      model: active.model,
      base_url: active.source === 'registry' ? active.baseUrl : undefined,
      has_key: Boolean(active.apiKey),
    },
    available,
    registry: registry.map((p) => ({
      id: p.id,
      name: p.name,
      base_url: p.baseUrl,
      model: p.model,
      scope: p.scope,
      enabled: Boolean(p.enabled),
    })),
  });
}
