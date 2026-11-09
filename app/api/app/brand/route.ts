// Marca white-label do tenant da sessão. Não editamos o portal aqui: esta rota
// apenas expõe getBrandForTenant() para quem precisar renderizar a marca.
import { NextResponse } from 'next/server';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireAction } from '@/lib/tenant/rbac';
import { getBrandForTenant } from '@/lib/tenant/brand';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedTenantId = Number(url.searchParams.get('tenant_id')) || null;
  const ctx = await resolveTenantContext({ surface: 'app', requestedTenantId });
  requireAction(ctx, 'read');

  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'Sem tenant ativo' }, { status: 400 });
  }

  const brand = await getBrandForTenant(ctx.tenantId);
  return NextResponse.json({ tenant: ctx.tenantId, brand });
}
