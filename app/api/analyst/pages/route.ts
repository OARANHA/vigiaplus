// Modo analista: as 64 paginas do Radar continuam intactas e acessiveis a equipe.
import { NextResponse } from 'next/server';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireAction, requireSurface } from '@/lib/tenant/rbac';
import { requireFeature } from '@/lib/tenant/entitlements';
import { ANALYST_PAGES } from '@/lib/tenant/catalog';

export async function GET() {
  const ctx = await resolveTenantContext({ surface: 'analyst' });
  requireSurface(ctx, 'analyst');
  requireAction(ctx, 'read');
  await requireFeature(ctx, 'analyst_mode');

  return NextResponse.json({
    note: 'As 64 paginas do Radar continuam intactas e acessiveis so a equipe.',
    groups: ANALYST_PAGES,
    tenant: ctx.tenantId,
  });
}
