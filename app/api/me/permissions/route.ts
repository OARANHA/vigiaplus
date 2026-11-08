// Permissoes do usuario atual + prova viva da invariante A4:
// o fingerprint NAO depende do modo (basico/avancado).
import { NextResponse } from 'next/server';
import { resolveTenantContext } from '@/lib/tenant/context';
import { permissionsFingerprint } from '@/lib/tenant/rbac';
import { enabledFeatures } from '@/lib/tenant/entitlements';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const surface = url.searchParams.get('surface') ?? 'app';
  const ctx = await resolveTenantContext({ surface: surface as 'app' | 'console' | 'analyst' });

  return NextResponse.json({
    view: { density: ctx.density, vocabulary: ctx.vocabulary },
    permissions: permissionsFingerprint(ctx),
    features: await enabledFeatures(ctx),
  });
}
