import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth';
import { resolveTenantContext, appendAudit } from '@/lib/tenant/context';
import { VIEW_PREFS_COOKIE, readViewPrefs, type ViewPrefs } from '@/lib/view-prefs';

// GET /api/me/preferences — preferencias de visualizacao do usuario + dispositivo.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'nao autenticado' }, { status: 401 });
  }
  return NextResponse.json({
    density: user.viewDensity,
    vocabulary: user.viewVocabulary,
    locale: user.locale,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  });
}

// PATCH /api/me/preferences — atualiza densidade (basico/avancado), vocabulario
// (leigo/tecnico) e/ou locale. Estas preferencias NAO afetam permissoes (ADR-03).
// Body: { density?: 'basico'|'avancado', vocabulary?: 'leigo'|'tecnico', locale?: string }
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'nao autenticado' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const apiUpdates: Record<string, string> = {};
  // Drizzle espera as CHAVES DO SCHEMA (camelCase), nao os nomes das colunas.
  const dbUpdates: Record<string, string> = {};

  if (body.density === 'basico' || body.density === 'avancado') {
    apiUpdates.view_density = body.density;
    dbUpdates.viewDensity = body.density;
  }
  if (body.vocabulary === 'leigo' || body.vocabulary === 'tecnico') {
    apiUpdates.view_vocabulary = body.vocabulary;
    dbUpdates.viewVocabulary = body.vocabulary;
  }
  if (typeof body.locale === 'string' && body.locale.length >= 2 && body.locale.length <= 10) {
    apiUpdates.locale = body.locale;
    dbUpdates.locale = body.locale;
  }

  if (Object.keys(apiUpdates).length === 0) {
    return NextResponse.json({ error: 'nenhuma preferencia valida fornecida' }, { status: 400 });
  }

  // Persistir na conta (usuarios reais). No demo o usuario e sintetico e
  // pode nao existir na tabela: o cookie garante a preferencia mesmo assim.
  try {
    const db = await getDb();
    await db.update(users).set(dbUpdates).where(eq(users.id, user.id));
  } catch (e) {
    console.warn('[preferences] conta nao atualizada (demo?):', (e as Error).message);
  }

  const current = await readViewPrefs();
  const merged: ViewPrefs = {
    density: (apiUpdates.view_density as ViewPrefs['density']) ?? current.density,
    vocabulary: (apiUpdates.view_vocabulary as ViewPrefs['vocabulary']) ?? current.vocabulary,
    locale: apiUpdates.locale ?? current.locale,
  };
  const res = NextResponse.json({ ok: true, updated: apiUpdates });
  res.cookies.set(VIEW_PREFS_COOKIE, JSON.stringify(merged), {
    path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365,
  });

  // Auditoria: rastreavel, mas sem qualquer efeito sobre permissoes.
  const ctx = await resolveTenantContext({ surface: 'app' }).catch(() => null);
  if (ctx) {
    try {
      await appendAudit(ctx, {
        action: 'PREFERENCES_UPDATED',
        target: `user:${user.id}`,
        reason: JSON.stringify(apiUpdates),
      });
    } catch { /* auditoria indisponivel: nao critico */ }
  }

  return res;
}
