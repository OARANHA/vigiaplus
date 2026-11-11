/**
 * ALT-03 — Fatos analíticos rastreáveis, gerados somente a partir de alertas
 * persistidos por lib/alerts.ts e vinculados ao tenant pelo projeto.
 *
 * Não executar detectAlerts() aqui: o worker de notificações consome fatos
 * existentes, não inventa anomalias nem dispara nova análise com IA.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { alerts, projects } from '@/lib/db/schema';
import type { FactInput } from './evaluate';

const DAY_MS = 24 * 60 * 60 * 1000;

function measured(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function loadAnalyticAlertFacts(
  db: DB, tenantId: number, at: Date,
): Promise<FactInput[]> {
  if (!Number.isSafeInteger(tenantId) || tenantId < 1 || Number.isNaN(at.getTime())) {
    return [];
  }
  const since = new Date(at.getTime() - DAY_MS);
  const rows = await db.select({
    alertId: alerts.id,
    projectId: alerts.projectId,
    projectName: projects.name,
    type: alerts.type,
    severity: alerts.severity,
    data: alerts.data,
    createdAt: alerts.createdAt,
  }).from(alerts)
    .innerJoin(projects, eq(alerts.projectId, projects.id))
    .where(and(
      eq(projects.tenantId, tenantId),
      gte(alerts.createdAt, since),
      lte(alerts.createdAt, at),
    ))
    .orderBy(desc(alerts.createdAt))
    .limit(500);

  const facts: FactInput[] = [];
  for (const alert of rows) {
    const data = alert.data ?? {};
    if (alert.type === 'volume_spike') {
      const last24 = measured(data.last24);
      const avgDaily = measured(data.avgDaily);
      if (last24 === null || last24 < 0 || avgDaily === null || avgDaily < 0) continue;
      facts.push({
        kind: 'analytics', anomalyType: 'volume_spike', id: alert.alertId,
        projectId: alert.projectId, title: alert.projectName,
        severity: alert.severity, last24, avgDaily,
        ocorridoEm: alert.createdAt,
        source: `Alerta #${alert.alertId} no projeto #${alert.projectId}: ${last24} menções em 24h; base dos 7 dias anteriores ${avgDaily} menções/dia`,
      });
    } else if (alert.type === 'sentiment_drop') {
      const avg24 = measured(data.avg24);
      const avgPrev = measured(data.avgPrev);
      if (avg24 === null || avgPrev === null || avg24 >= avgPrev) continue;
      facts.push({
        kind: 'analytics', anomalyType: 'sentiment_drop', id: alert.alertId,
        projectId: alert.projectId, title: alert.projectName,
        severity: alert.severity, avg24, avgPrev,
        ocorridoEm: alert.createdAt,
        source: `Alerta #${alert.alertId} no projeto #${alert.projectId}: sentimento médio 24h ${avg24}; média dos 7 dias anteriores ${avgPrev}`,
      });
    }
  }
  return facts;
}
