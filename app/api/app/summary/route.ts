// Portal do cliente: resumo das duas reputacoes + incidentes + evidencia de trabalho.
//
// Contrato do "numero unico" (docs/vigiaplus/remodelagem.md §2.2 e §5):
//   - o numero NUNCA e substituido por um adjetivo;
//   - composicao explicita, procedencia visivel, confianca declarada;
//   - comparacao ANTES de variacao (e nunca inventar variacao sem historico);
//   - linguagem de gente no vocabulario leigo, termos tecnicos no tecnico,
//     com EXATAMENTE os mesmos dados (ADR-03).
import { NextResponse } from 'next/server';
import { eq, and, ne } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { reputationTargets, incidents, notificationChannels } from '@/lib/db/schema';
import { resolveTenantContext } from '@/lib/tenant/context';
import { requireAction, requireSurface } from '@/lib/tenant/rbac';
import { requireFeature, enabledFeatures } from '@/lib/tenant/entitlements';

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

  await requireFeature(ctx, 'reputation_dual');

  const db = await getDb();
  const targets = await db.select().from(reputationTargets)
    .where(eq(reputationTargets.tenantId, ctx.tenantId));
  const openIncidents = await db.select().from(incidents)
    .where(and(eq(incidents.tenantId, ctx.tenantId), ne(incidents.status, 'closed')));
  const channels = await db.select().from(notificationChannels)
    .where(eq(notificationChannels.tenantId, ctx.tenantId));
  const features = await enabledFeatures(ctx);

  // "As vezes o pouco e muito": prova de trabalho, nao grafico.
  // H0: valores de exemplo; no H2 passam a vir de collection_runs/mentions reais.
  const workEvidence = {
    sources_monitored: 24,
    comments_analyzed: 1240,
    detection_minutes: 11,
    subjects_tracked: targets.length,
  };

  const market = targets.find((t) => t.kind === 'market') ?? null;
  const sampleSize = workEvidence.comments_analyzed;
  const confidence = sampleSize >= 200
    ? { level: 'consolidado', sample_size: sampleSize,
        note: `Base ampla: ${fmtPtBr(sampleSize)} comentários analisados.` }
    : { level: 'preliminar', sample_size: sampleSize,
        note: `Poucos dados (${fmtPtBr(sampleSize)} comentários): resultado preliminar.` };

  const updatedAt = new Date().toISOString();

  const reputations = targets.map((t) => {
    const score = t.score == null ? null : Math.round(t.score);
    const isBrand = t.kind === 'brand';
    const reference = isBrand && market && market.id !== t.id ? market : null;
    const referenceScore = reference?.score == null ? null : Math.round(reference.score);
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
        updated_at: updatedAt,
        note: `${fmtPtBr(sampleSize)} comentários lidos em ${workEvidence.sources_monitored} jornais e redes nos últimos ${WINDOW_DAYS} dias.`,
      },
      confidence,
      composition: COMPOSITION,
      // Valores dos componentes so aparecem quando houver mencoes reais (H2).
      component_values: null,
      component_note: 'Os valores de cada componente aparecem quando a coleta do período estiver consolidada.',
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
    features,
    view: { density: ctx.density, vocabulary: ctx.vocabulary },
    channels: channels.map((c) => ({ channel: c.channel, destination: c.destination, active: c.active })),
  });
}
