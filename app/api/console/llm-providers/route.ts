// Console do dono: LLM Registry - listar e cadastrar provedores
import { NextResponse } from 'next/server';
import { resolveTenantContext, parseRequestedTenantId } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { registerProvider, listProviders } from '@/lib/tenant/llm-registry';
import { PLANS } from '@/lib/tenant/catalog';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx = await resolveTenantContext({ surface: 'console', requestedTenantId });
  requireOwner(ctx);
  const providers = await listProviders(ctx);
  return NextResponse.json({ providers, plans: PLANS });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx = await resolveTenantContext({ surface: 'console', requestedTenantId });
  requireOwner(ctx);

  const body = await request.json();
  const allowInsecure = process.env.VIGIA_ALLOW_INSECURE_LLM === '1';
  const allowPrivateHosts = process.env.VIGIA_ALLOW_PRIVATE_LLM === '1';

  try {
    const provider = await registerProvider(ctx, body, { allowInsecure, allowPrivateHosts });
    return NextResponse.json({ provider }, { status: 201 });
  } catch (e) {
    const err = e as { code?: string; message?: string; status?: number };
    return NextResponse.json(
      { error: err.code ?? 'BAD_REQUEST', message: err.message ?? String(e) },
      { status: err.status ?? 400 },
    );
  }
}
