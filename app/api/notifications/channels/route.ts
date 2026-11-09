// H2 - Canais de notificacao por tenant.
// O tenant_id vem SEMPRE da sessao (resolveTenantContext), nunca do body.
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { notificationChannels } from '@/lib/db/schema';
import { resolveTenantContext, parseRequestedTenantId, type TenantContext } from '@/lib/tenant/context';
import { requireAction } from '@/lib/tenant/rbac';
import { AppError } from '@/lib/tenant/errors';
import { KNOWN_CHANNELS } from '@/lib/notifications/evaluate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resolve o contexto, exige a acao e garante que ha tenant na sessao. */
async function authorize(request: Request, action: string): Promise<number> {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx: TenantContext = await resolveTenantContext({ surface: 'app', requestedTenantId });
  requireAction(ctx, action);
  if (!ctx.tenantId) throw AppError.badRequest('Sem tenant ativo na sessao');
  return ctx.tenantId;
}

function fail(e: unknown): NextResponse {
  if (e instanceof AppError) {
    return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: 'BAD_REQUEST', message }, { status: 400 });
}

function asBody(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Converte booleano/0/1 para o inteiro gravado no banco. */
function toFlag(v: unknown): 0 | 1 {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  throw AppError.badRequest('active/verified deve ser booleano ou 0/1');
}

function readId(v: unknown): number {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('id invalido');
  return id;
}

// GET /api/notifications/channels - lista os canais do tenant (leitura).
export async function GET(request: Request) {
  try {
    const tenantId = await authorize(request, 'read');
    const db = await getDb();
    const rows = await db.select().from(notificationChannels)
      .where(eq(notificationChannels.tenantId, tenantId));
    return NextResponse.json({
      channels: rows.map((c) => ({
        id: c.id,
        channel: c.channel,
        destination: c.destination,
        verified: c.verified === 1,
        active: c.active === 1,
        createdAt: c.createdAt,
      })),
    });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/notifications/channels - cria {channel, destination}, verified: 0.
export async function POST(request: Request) {
  try {
    const tenantId = await authorize(request, 'manage_notifications');
    const body = asBody(await request.json().catch(() => null));

    if (typeof body.channel !== 'string' || !KNOWN_CHANNELS.includes(body.channel)) {
      throw AppError.badRequest('Canal desconhecido');
    }
    if (typeof body.destination !== 'string' || !body.destination.trim()) {
      throw AppError.badRequest('Destino nao pode ser vazio');
    }

    const db = await getDb();
    const [row] = await db.insert(notificationChannels).values({
      tenantId,
      channel: body.channel,
      destination: body.destination.trim(),
      verified: 0,
      active: 1,
    }).returning();
    return NextResponse.json({ channel: row }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/notifications/channels - atualiza active/verified (id + tenant).
export async function PATCH(request: Request) {
  try {
    const tenantId = await authorize(request, 'manage_notifications');
    const body = asBody(await request.json().catch(() => null));
    const id = readId(body.id);

    const set: { active?: number; verified?: number } = {};
    if (Object.prototype.hasOwnProperty.call(body, 'active')) set.active = toFlag(body.active);
    if (Object.prototype.hasOwnProperty.call(body, 'verified')) set.verified = toFlag(body.verified);
    if (Object.keys(set).length === 0) throw AppError.badRequest('Nada para atualizar');

    const db = await getDb();
    const [row] = await db.update(notificationChannels).set(set)
      .where(and(
        eq(notificationChannels.id, id),
        eq(notificationChannels.tenantId, tenantId),
      )).returning();
    if (!row) throw AppError.notFound('Canal nao encontrado');
    return NextResponse.json({ channel: row });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/notifications/channels - remove por id (id + tenant).
export async function DELETE(request: Request) {
  try {
    const tenantId = await authorize(request, 'manage_notifications');
    const url = new URL(request.url);
    let raw: unknown = url.searchParams.get('id');
    if (raw === null || raw === '') raw = asBody(await request.json().catch(() => null)).id;
    const id = readId(raw);

    const db = await getDb();
    const removed = await db.delete(notificationChannels)
      .where(and(
        eq(notificationChannels.id, id),
        eq(notificationChannels.tenantId, tenantId),
      )).returning({ id: notificationChannels.id });
    if (removed.length === 0) throw AppError.notFound('Canal nao encontrado');
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return fail(e);
  }
}
