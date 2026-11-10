// Portal do cliente: resumo das duas reputacoes + incidentes + evidencia de trabalho.
//
// Contrato do "numero unico" (docs/vigiaplus/remodelagem.md §2.2 e §5):
//   - o numero NUNCA e substituido por um adjetivo;
//   - composicao explicita, procedencia visivel, confianca declarada;
//   - comparacao ANTES de variacao (e nunca inventar variacao sem historico);
//   - linguagem de gente no vocabulario leigo, termos tecnicos no tecnico,
//     com EXATAMENTE os mesmos dados (ADR-03).
import { NextResponse } from 'next/server';
import { eq, and, ne, gte, sql, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { reputationTargets, incidents, notificationChannels, mentions, projects, collectionRuns } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireAction, requireSurface } from '@/lib/tenant/rbac';
import { requireFeature, enabledFeatures } from '@/lib/tenant/entitlements';
import { AppError } from '@/lib/tenant/errors';

const WINDOW_DAYS = 14;

// Pesos reais de lib/insights.ts (healthFor/brandHealthReport).
const COMPOSITION = [
  { key: 'sentiment', label: 'Tom das conversas', technical: 'Sentiment', weight: 35 },
  { key: 'positivity', label: 'Parcela de comentários favoráveis', technical: 'Positive share', weight: 25 },
  { key: 'momentum', label: 'Ritmo das citações', technical: 'Momentum', weight: 20 },
  { key: 'reach', label: 'Alcance das publicações', technical: 'Resonance', weight: 20 },
];

function fmtPtBr(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedTenantId = Number(url.searchParams.get('tenant_id')) || null;
  const ctx = await resolveTenantContext({ surface: 'app', requestedTenantId });
  requireSurface(ctx, 'app');
  requireAction(ctx, 'read');

  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'Sem tenant ativo' }, { status: 400 });
  }

  try {
    await requireFeature(ctx, 'reputation_dual');
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: error.status });
    }
    throw error;
  }

  const db = await getDb();
  const targets = await db.select().from(reputationTargets)
    .where(eq(reputationTargets.tenantId, ctx.tenantId));
  const openIncidents = await db.select().from(incidents)
    .where(and(eq(incidents.tenantId, ctx.tenantId), ne(incidents.status, 'closed')));
  const channels = await db.select().from(notificationChannels)
    .where(eq(notificationChannels.tenantId, ctx.tenantId));
  const features = await enabledFeatures(ctx);

  // Evidência real do tenant na janela de 14 dias, não números sintéticos.
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const [observed] = await db.select({
    received: sql<number>`count(${mentions.id})::int`,
    analyzed: sql<number>`count(${mentions.analyzedAt})::int`,
    sources: sql<number>`count(distinct ${mentions.source})::int`,
    latest: sql<Date | null>`max(${mentions.fetchedAt})`,
  }).from(mentions).innerJoin(projects, eq(mentions.projectId, projects.id))
    .where(and(eq(projects.tenantId, ctx.tenantId), gte(mentions.publishedAt, since)));

  // Última tentativa de coleta independe de haver menções. Não confundir
  // ausência de publicações na janela com ausência de execução do coletor.
  const [lastCollection] = await db.select({
    status: collectionRuns.status,
    startedAt: collectionRuns.startedAt,
    finishedAt: collectionRuns.finishedAt,
    newCount: collectionRuns.newCount,
  }).from(collectionRuns).innerJoin(projects, eq(collectionRuns.projectId, projects.id))
    .where(eq(projects.tenantId, ctx.tenantId))
    .orderBy(desc(collectionRuns.startedAt), desc(collectionRuns.id)).limit(1);

  const sampleSize = Number(observed?.analyzed ?? 0);
  const sourceCount = Number(observed?.sources ?? 0);
  const lastCollected = observed?.latest ? new Date(observed.latest).toISOString() : null;
  const workEvidence = {
    sources_monitored: sourceCount,
    window_days: WINDOW_DAYS,
    comments_analyzed: sampleSize,
    mentions_collected: Number(observed?.received ?? 0),
    detection_minutes: null, // sem SLA medido e verificável
    subjects_tracked: targets.length,
    updated_at: lastCollected,
  };
  const market = targets.find((t) => t.kind === 'market') ?? null;
  const confidence = sampleSize === 0
    ? { level: 'sem_dados', sample_size: 0, note: 'Nenhuma menção analisada no período.' }
    : sampleSize >= 200
      ? { level: 'consolidado', sample_size: sampleSize,
          note: `Amostra observada: ${fmtPtBr(sampleSize)} menções analisadas.` }
      : { level: 'preliminar', sample_size: sampleSize,
          note: `Amostra pequena: ${fmtPtBr(sampleSize)} menções analisadas.` };
  const demo = process.env.DEMO_MODE === '1';

  const reputations = targets.map((t) => {
    // O score cadastrado ainda não é derivado de menções por alvo.
    const score = !demo || sampleSize === 0 || t.score == null ? null : Math.round(t.score);
    const isBrand = t.kind === 'brand';
    const reference = isBrand && market && market.id !== t.id ? market : null;
    const referenceScore = demo && sampleSize > 0 && reference?.score != null ? Math.round(reference.score) : null;
    const delta = score != null && referenceScore != null ? score - referenceScore : null;

    // Frase curta, respeitosa e COMPARATIVA. Nunca um rotulo vazio tipo "boa e estavel".
    let headline: string;
    if (score == null) {
      headline = 'Ainda estamos reunindo comentários suficientes para calcular sua reputação.';
    } else if (delta != null && reference) {
      headline = delta > 0
        ? `${isBrand ? 'Sua marca' : 'Este alvo'} está em ${score} de 100, ${delta} ${delta === 1 ? 'ponto acima' : 'pontos acima'} de ${reference.name} (${referenceScore}).`
        : delta < 0
          ? `${isBrand ? 'Sua marca' : 'Este alvo'} está em ${score} de 100, ${Math.abs(delta)} ${Math.abs(delta) === 1 ? 'ponto abaixo' : 'pontos abaixo'} de ${reference.name} (${referenceScore}).`
          : `${isBrand ? 'Sua marca' : 'Este alvo'} está em ${score} de 100, em linha com ${reference.name} (${referenceScore}).`;
    } else {
      headline = `${isBrand ? 'Sua marca' : 'Este alvo'} está em ${score} de 100 neste período.`;
    }

    return {
      id: t.id,
      kind: t.kind,
      name: t.name,
      score,                 // numero SEMPRE presente (ou null, com explicacao)
      scale: 100,
      headline,
      tone: score == null ? 'neutral' : delta != null && delta < 0 ? 'attention' : 'positive',
      comparison: {
        reference: reference?.name ?? null,
        reference_score: referenceScore,
        delta,
        window_days: WINDOW_DAYS,
        // Sem serie temporal real: dizer isso, em vez de inventar um "+3".
        temporal_delta: null,
        temporal_note: 'Ainda não há histórico suficiente para comparar com a semana anterior.',
      },
      provenance: {
        comments: sampleSize,
        sources: workEvidence.sources_monitored,
        window_days: WINDOW_DAYS,
        updated_at: lastCollected,
        note: sampleSize === 0
          ? 'Sem menções analisadas nesta janela; última coleta indisponível.'
          : `${fmtPtBr(sampleSize)} menções analisadas em ${sourceCount} fontes com dados nos últimos ${WINDOW_DAYS} dias.`,
      },
      confidence,
      composition: COMPOSITION,
      // Valores dos componentes so aparecem quando houver mencoes reais (H2).
      component_values: null,
      component_note: demo ? 'Pontuação demonstrativa, não representa monitoramento real.' : 'Pontuação indisponível até existir cálculo auditável por alvo.',
    };
  });

  return NextResponse.json({
    tenant: ctx.tenantId,
    greeting: `Bom dia, ${ctx.userName}`,
    reputations,
    open_incidents: openIncidents.length,
    incidents: openIncidents.map((i) => ({
      id: i.id, title: i.title, status: i.status, severity: i.severity, owner: i.owner,
    })),
    work_evidence: workEvidence,
    collection: lastCollection ? {
      status: lastCollection.status,
      lastAttemptAt: lastCollection.startedAt.toISOString(),
      finishedAt: lastCollection.finishedAt?.toISOString() ?? null,
      newCount: lastCollection.newCount,
    } : null,
    features,
    view: { density: ctx.density, vocabulary: ctx.vocabulary },
    channels: channels.map((c) => ({ channel: c.channel, destination: c.destination, active: c.active })),
  });
}
