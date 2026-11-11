// H2 - Regras de alerta por tenant.
// O tenant_id vem SEMPRE da sessao (resolveTenantContext), nunca do body.
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { alertRules } from '@/lib/db/schema';
import { resolveTenantContext, parseRequestedTenantId, type TenantContext } from '@/lib/tenant/context';
import { requireAction } from '@/lib/tenant/rbac';
import { AppError } from '@/lib/tenant/errors';
import { RULE_TYPES } from '@/lib/notifications/evaluate';
import { validateQuietWindow } from '@/lib/notifications/tenant-time';
import { requireFeature } from '@/lib/tenant/entitlements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SLA_MIN = 1;
const SLA_MAX = 10080; // 7 dias em minutos

async function authorize(request: Request, action: string): Promise<number> {
  const url = new URL(request.url);
  const requestedTenantId = parseRequestedTenantId(url.searchParams, request.headers);
  const ctx: TenantContext = await resolveTenantContext({ surface: 'app', requestedTenantId });
  requireAction(ctx, action);
  // SEC-01: regras e destinos não podem ser geridos sem contrato ativo.
  await requireFeature(ctx, 'crisis_management');
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

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function asThreshold(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function quietPair(from:unknown,to:unknown):{start:string|null;end:string|null} {
  try{return validateQuietWindow(from,to);}
  catch{throw AppError.badRequest('Silêncio exige horários HH:mm válidos e uma janela com liberação');}
}

/** Valida e converte slaMinutes; ausente = null (usa o default do banco). */
function readSla(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < SLA_MIN || n > SLA_MAX) {
    throw AppError.badRequest(`slaMinutes deve estar entre ${SLA_MIN} e ${SLA_MAX}`);
  }
  return n;
}

function readType(v: unknown): string {
  if (typeof v !== 'string' || !RULE_TYPES.includes(v)) {
    throw AppError.badRequest('Tipo de regra invalido');
  }
  return v;
}

function readId(v: unknown): number {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('id invalido');
  return id;
}

type RuleUpdate = {
  type?: string;
  threshold?: Record<string, unknown>;
  channels?: string[];
  silencioDe?: string | null;
  silencioAte?: string | null;
  slaMinutes?: number;
  active?: number;
};

function toFlag(v: unknown): 0 | 1 {
  if (v === true || v === 1) return 1;
  if (v === false || v === 0) return 0;
  throw AppError.badRequest('active deve ser booleano ou 0/1');
}

// GET /api/notifications/rules - lista as regras do tenant (leitura).
export async function GET(request: Request) {
  try {
    const tenantId = await authorize(request, 'read');
    const db = await getDb();
    const rows = await db.select().from(alertRules)
      .where(eq(alertRules.tenantId, tenantId));
    return NextResponse.json({ rules: rows });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/notifications/rules - cria regra validando type e slaMinutes.
export async function POST(request: Request) {
  try {
    const tenantId = await authorize(request, 'manage_notifications');
    const body = asBody(await request.json().catch(() => null));
    const type = readType(body.type);
    const sla = readSla(body.slaMinutes);
    const active = body.active === undefined ? 1 : toFlag(body.active);
    const quiet=quietPair(body.silencioDe??null,body.silencioAte??null);

    const db = await getDb();
    const [row] = await db.insert(alertRules).values({
      tenantId,
      type,
      threshold: asThreshold(body.threshold),
      channels: asStringArray(body.channels),
      silencioDe: quiet.start,
      silencioAte: quiet.end,
      slaMinutes: sla ?? 900,
      active,
    }).returning();
    return NextResponse.json({ rule: row }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/notifications/rules - atualiza campos (id + tenant).
export async function PATCH(request: Request) {
  try {
    const tenantId = await authorize(request, 'manage_notifications');
    const body = asBody(await request.json().catch(() => null));
    const id = readId(body.id);

    const set: RuleUpdate = {};
    if (Object.prototype.hasOwnProperty.call(body, 'type')) set.type = readType(body.type);
    if (Object.prototype.hasOwnProperty.call(body, 'threshold')) set.threshold = asThreshold(body.threshold);
    if (Object.prototype.hasOwnProperty.call(body, 'channels')) set.channels = asStringArray(body.channels);
    if (Object.prototype.hasOwnProperty.call(body, 'silencioDe') ||
        Object.prototype.hasOwnProperty.call(body, 'silencioAte')) {
      // Horários precisam ser enviados juntos: evita um intervalo parcial
      // capaz de desabilitar inadvertidamente o silêncio de uma regra.
      const quiet=quietPair(body.silencioDe,body.silencioAte);
      set.silencioDe=quiet.start;
      set.silencioAte=quiet.end;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'slaMinutes')) {
      const sla = readSla(body.slaMinutes);
      if (sla !== null) set.slaMinutes = sla;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'active')) set.active = toFlag(body.active);
    if (Object.keys(set).length === 0) throw AppError.badRequest('Nada para atualizar');

    const db = await getDb();
    const [row] = await db.update(alertRules).set(set)
      .where(and(eq(alertRules.id, id), eq(alertRules.tenantId, tenantId)))
      .returning();
    if (!row) throw AppError.notFound('Regra nao encontrada');
    return NextResponse.json({ rule: row });
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/notifications/rules - remove por id (id + tenant).
export async function DELETE(request: Request) {
  try {
    const tenantId = await authorize(request, 'manage_notifications');
    const url = new URL(request.url);
    let raw: unknown = url.searchParams.get('id');
    if (raw === null || raw === '') raw = asBody(await request.json().catch(() => null)).id;
    const id = readId(raw);

    const db = await getDb();
    const removed = await db.delete(alertRules)
      .where(and(eq(alertRules.id, id), eq(alertRules.tenantId, tenantId)))
      .returning({ id: alertRules.id });
    if (removed.length === 0) throw AppError.notFound('Regra nao encontrada');
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return fail(e);
  }
}
