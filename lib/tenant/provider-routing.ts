/**
 * Seleção determinística de provedores OpenAI-compatible:
 * tenant explícito > rota global; nunca selecionar provedor de outro tenant.
 * Sem I/O para testes de isolamento.
 */
export type ProviderCandidate = {
  id: string;
  scope: string;
  tenantId: number | null;
  enabled: number;
};
export type RouteCandidate = {
  purpose: string;
  tenantId: number | null;
  providerId: string;
  priority: number;
};

export function providerVisible(p: ProviderCandidate, tenantId: number | null): boolean {
  if (p.enabled !== 1) return false;
  if (p.scope === 'global') return p.tenantId == null;
  return p.scope === 'tenant' && tenantId != null && p.tenantId === tenantId;
}

export function pickRoutedProvider<P extends ProviderCandidate>(
  tenantId: number | null,
  purpose: string,
  providers: readonly P[],
  routes: readonly RouteCandidate[],
  overrideId?: string,
): P | null {
  const allowed = (p: P) => providerVisible(p, tenantId);
  if (overrideId) return providers.find((p) => p.id === overrideId && allowed(p)) ?? null;

  const routeList = routes
    .filter((route) => route.purpose === purpose &&
      (route.tenantId === null || route.tenantId === tenantId))
    .sort((a, b) => {
      const aSpecific = tenantId != null && a.tenantId === tenantId ? 0 : 1;
      const bSpecific = tenantId != null && b.tenantId === tenantId ? 0 : 1;
      return aSpecific - bSpecific || a.priority - b.priority;
    });
  for (const route of routeList) {
    const matched = providers.find((p) => p.id === route.providerId && allowed(p));
    if (matched) return matched;
  }
  return null;
}
