// Console do dono: testar conexao de um provedor LLM
import { NextResponse } from 'next/server';
import { resolveTenantContext, parseRequestedTenantId } from '@/lib/tenant/context';
import { requireOwner } from '@/lib/tenant/rbac';
import { testConnection } from '@/lib/tenant/llm-registry';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx = await resolveTenantContext({ surface: 'console', requestedTenantId });
  requireOwner(ctx);
  const { id } = await params;

  try {
    const result = await testConnection(ctx, id, {
      resolve: async () => ['8.8.8.8'],
      fetchImpl: async () => ({ ok: true, status: 200 } as Response),
    });
    return NextResponse.json(result);
  } catch (e) {
    const err = e as { code?: string; message?: string; status?: number };
    return NextResponse.json(
      { error: err.code ?? 'BAD_REQUEST', message: err.message ?? String(e) },
      { status: err.status ?? 400 },
    );
  }
}
