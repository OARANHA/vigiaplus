// Console do dono: features por tenant (ver e alterar)
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { tenantFeatures } from '@/lib/db/schema';
import { resolveTenantContext, parseRequestedTenantId } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { featureState, setTenantFeature } from '@/lib/tenant/entitlements';
import { FEATURE_CATALOG } from '@/lib/tenant/catalog';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx = await resolveTenantContext({ surface: 'console', requestedTenantId });
  requireOwner(ctx);
  const tenantId = Number((await params).id);

  // Constroi o catalogo com o estado de cada feature para este tenant
  const targetCtx = { ...ctx, tenantId, system: false };
  const catalog = [];
  for (const f of FEATURE_CATALOG) {
    const state = await featureState(targetCtx, f.key);
    catalog.push({ ...f, ...state });
  }

  return NextResponse.json({ catalog, tenantId });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx = await resolveTenantContext({ surface: 'console', requestedTenantId });
  requireOwner(ctx);
  const tenantId = Number((await params).id);
  const body = await request.json();

  try {
    await setTenantFeature(ctx, tenantId, body);
    return NextResponse.json({ ok: true, tenantId, feature: body.feature_key, enabled: body.enabled });
  } catch (e) {
    const err = e as { code?: string; message?: string; status?: number };
    return NextResponse.json(
      { error: err.code ?? 'BAD_REQUEST', message: err.message ?? String(e) },
      { status: err.status ?? 400 },
    );
  }
}
