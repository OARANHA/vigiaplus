// Evidências públicas por cliente, consultadas APENAS após resolver a sessão e o vínculo do tenant.
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { getDb, type DB } from '@/lib/db';
import { mentions, projects } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireAction, requireSurface } from '@/lib/tenant/rbac';
import { requireFeature } from '@/lib/tenant/entitlements';
import { AppError } from '@/lib/tenant/errors';

export const dynamic = 'force-dynamic';

export async function listTenantEvidence(db: DB, tenantId: number, limit = 12) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw new Error('Tenant inválido');
  return db.select({
    id: mentions.id,
    title: mentions.title,
    url: mentions.url,
    source: mentions.source,
    publishedAt: mentions.publishedAt,
    projectName: projects.name,
  }).from(mentions)
    .innerJoin(projects, eq(mentions.projectId, projects.id))
    .where(eq(projects.tenantId, tenantId))
    .orderBy(desc(mentions.publishedAt), desc(mentions.id))
    .limit(Math.max(1, Math.min(limit, 25)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get('tenant_id'));
  const ctx = await resolveTenantContext({
    surface: 'app',
    requestedTenantId: Number.isSafeInteger(requested) && requested > 0 ? requested : null,
  });
  requireSurface(ctx, 'app');
  requireAction(ctx, 'read');
  if (!ctx.tenantId) return NextResponse.json({ error: 'Selecione um cliente autorizado' }, { status: 400 });
  // SEC-01: conhecer a organização não concede acesso a dados coletados.
  // O contrato e a feature são revalidados em cada consulta e negam
  // organizações pendentes/suspensas, assinatura ausente ou vencida.
  try {
    await requireFeature(ctx, 'reputation_dual');
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }
  const db = await getDb();
  const items = await listTenantEvidence(db, ctx.tenantId);
  return NextResponse.json({
    tenantId: ctx.tenantId,
    items: items.map((m) => ({
      ...m,
      url: safePublicHttpUrl(m.url),
      publishedAt: m.publishedAt?.toISOString() ?? null,
    })),
  });
}

function safePublicHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
