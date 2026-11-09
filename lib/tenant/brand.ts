import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenants } from '@/lib/db/schema';

// ---------------------------------------------------------------------------
// White-label por tenant (ADR-08). A marca vem de tenants.brand_config e do
// nome do próprio tenant; quando não há tenant ou config, volta a VigiaPlus.
// Nunca se lê o tenant do request: quem chama esta função já recebeu o id do
// TenantContext (resolveTenantContext), que vem da sessão autenticada.
// ---------------------------------------------------------------------------

export type TenantBrand = {
  name: string;
  logo: string | null;
  color: string | null;
  domain: string | null;
};

export const DEFAULT_BRAND: TenantBrand = {
  name: 'VigiaPlus',
  logo: null,
  color: null,
  domain: null,
};

/**
 * Marca efetiva de um tenant. `brandConfig` é opcional no banco; campos
 * ausentes caem no fallback sem inventar valores.
 */
export async function getBrandForTenant(tenantId: number): Promise<TenantBrand> {
  if (!Number.isInteger(tenantId) || tenantId <= 0) return { ...DEFAULT_BRAND };

  const db = await getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) return { ...DEFAULT_BRAND };

  const cfg = tenant.brandConfig ?? {};
  return {
    name: tenant.name?.trim() || DEFAULT_BRAND.name,
    logo: cfg.logo ?? null,
    color: cfg.color ?? null,
    domain: cfg.domain ?? tenant.domain ?? null,
  };
}
