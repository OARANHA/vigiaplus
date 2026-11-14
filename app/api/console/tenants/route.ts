// Console do dono: lista de tenants
import { NextResponse } from 'next/server';
import { AppError } from '@/lib/tenant/errors';
import { getDb } from '@/lib/db';
import { tenants, subscriptions, plans } from '@/lib/db/schema';
import { resolveTenantContext, parseRequestedTenantId, appendAudit } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  try {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx = await resolveTenantContext({ surface: 'console', requestedTenantId });
  requireOwner(ctx);

  const db = await getDb();
  const allTenants = await db.select().from(tenants);
  const allSubs = await db.select().from(subscriptions);

  return NextResponse.json({
    tenants: allTenants.map((t) => {
      const sub = allSubs.find((s) => s.tenantId === t.id && s.status === 'active');
      return {
        id: t.id,
        name: t.name,
        slug: t.slug,
        cnpj: t.cnpj,
        domain: t.domain,
        plan: t.planKey,
        status: t.status,
        locale: t.locale,
        subscription: sub ? { planKey: sub.planKey, status: sub.status } : null,
      };
    }),
    current: ctx.tenantId,
  });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('VIGIAPLUS_GET_UNEXPECTED_FAILURE', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

/** Cadastra organização sem criar assinatura, cobrança ou acesso automaticamente. */
export async function POST(request: Request) {
  const ctx = await resolveTenantContext({ surface: 'console' });
  requireOwner(ctx);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'JSON_INVALIDO' }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  const cnpj = typeof body.cnpj === 'string' ? body.cnpj.trim() : null;
  if (name.length < 2 || name.length > 120 || !/^[a-z0-9][a-z0-9-]{2,62}$/.test(slug) ||
      (cnpj && !/^[0-9.\/-]{14,18}$/.test(cnpj))) {
    return NextResponse.json({ error: 'DADOS_INVALIDOS', message: 'Nome, identificador ou CNPJ inválido' }, { status: 400 });
  }
  const db = await getDb();
  const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (existing) return NextResponse.json({ error: 'SLUG_EXISTS' }, { status: 409 });
  const [trial] = await db.select({ key: plans.key }).from(plans).where(eq(plans.key, 'trial')).limit(1);
  if (!trial) return NextResponse.json({ error: 'TRIAL_NOT_CONFIGURED' }, { status: 409 });
  const [tenant] = await db.insert(tenants).values({
    name, slug, cnpj, planKey: 'trial', status: 'pending', locale: 'pt-BR',
  }).returning({ id: tenants.id });
  await appendAudit(ctx, { action: 'TENANT_CREATED', target: 'tenant:' + tenant.id,
    reason: 'Cadastro administrativo pendente de contrato e convite' });
  return NextResponse.json({ id: tenant.id, status: 'pending', hasAccess: false }, { status: 201 });
}
