/**
 * Worker de notificacoes H2: `npm run worker:notify`.
 *
 * Uma unica passada: busca tenants ativos, carrega regras/canais/fatos por
 * tenant, planeja entregas (modulo puro evaluate), enfileira de forma
 * idempotente e despacha a fila uma vez. Nenhum loop infinito sobre gateway.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '../../lib/db';
import {
  tenants, alertRules, notificationChannels, incidents, reputationTargets, invoices,
} from '../../lib/db/schema';
import { enqueue, dispatchPending } from '../../lib/notifications/queue';
import {
  planDeliveries, type RuleInput, type ChannelInput, type FactInput,
} from '../../lib/notifications/evaluate';

type Resumo = {
  worker: string;
  tenants: number;
  regras: number;
  canais: number;
  fatos: number;
  planejados: number;
  enfileirados: number;
  entregas: { sent: number; failed: number };
  executadoEm: string;
};

function brl(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Transforma as linhas do tenant em fatos pontuais e concretos. */
async function carregarFatos(tenantId: number, at: Date): Promise<{
  rules: RuleInput[];
  channels: ChannelInput[];
  facts: FactInput[];
}> {
  const db = await getDb();
  const [ruleRows, channelRows, incidentRows, reputationRows, invoiceRows] = await Promise.all([
    db.select().from(alertRules).where(eq(alertRules.tenantId, tenantId)),
    db.select().from(notificationChannels).where(eq(notificationChannels.tenantId, tenantId)),
    db.select().from(incidents).where(eq(incidents.tenantId, tenantId)),
    db.select().from(reputationTargets).where(eq(reputationTargets.tenantId, tenantId)),
    db.select().from(invoices).where(eq(invoices.tenantId, tenantId)),
  ]);

  const rules: RuleInput[] = ruleRows.map((r) => ({
    id: r.id,
    type: r.type,
    threshold: r.threshold ?? {},
    channels: r.channels ?? [],
    silencioDe: r.silencioDe,
    silencioAte: r.silencioAte,
    slaMinutes: r.slaMinutes,
    active: r.active,
  }));

  const channels: ChannelInput[] = channelRows.map((c) => ({
    channel: c.channel,
    destination: c.destination,
    active: c.active,
    verified: c.verified,
  }));

  const facts: FactInput[] = [];

  // Incidentes ativos (fechados/resolvidos nao disparam crise aberta).
  for (const i of incidentRows) {
    if (i.status === 'closed' || i.status === 'resolved') continue;
    facts.push({
      kind: 'incident',
      id: i.id,
      title: i.title,
      severity: i.severity,
      source: `Incidente #${i.id} (status ${i.status}, SLA ${i.slaNextAt ? i.slaNextAt.toISOString() : 'sem prazo'})`,
      ocorridoEm: i.openedAt,
    });
  }

  // Alvos de reputacao com score medido (sem historico => sem delta inventado).
  for (const r of reputationRows) {
    if (r.score === null || r.score === undefined) continue;
    facts.push({
      kind: 'reputation',
      id: r.id,
      title: r.name,
      severity: 'media',
      score: r.score,
      source: `Alvo ${r.name} (${r.kind}), medido em ${at.toISOString().slice(0, 10)}`,
    });
  }

  // Faturas em aberto/vencidas alimentam regras 'fatura_vencida'.
  for (const inv of invoiceRows) {
    if (inv.status !== 'open' && inv.status !== 'overdue') continue;
    facts.push({
      kind: 'billing',
      id: inv.id,
      title: inv.description ?? `Fatura #${inv.id}`,
      severity: 'alta',
      source: `Fatura #${inv.id} de R$ ${brl(inv.amountBrl)} com vencimento em ${inv.dueAt ?? 'sem data'} (status ${inv.status})`,
      ocorridoEm: inv.dueAt ? new Date(`${inv.dueAt}T00:00:00Z`) : undefined,
    });
  }

  return { rules, channels, facts };
}

async function main(): Promise<void> {
  const db = await getDb();
  const at = new Date();
  const ativos = await db.select().from(tenants).where(eq(tenants.status, 'active'));

  const resumo: Resumo = {
    worker: 'notify',
    tenants: 0,
    regras: 0,
    canais: 0,
    fatos: 0,
    planejados: 0,
    enfileirados: 0,
    entregas: { sent: 0, failed: 0 },
    executadoEm: at.toISOString(),
  };

  for (const tenant of ativos) {
    const { rules, channels, facts } = await carregarFatos(tenant.id, at);
    resumo.tenants++;
    resumo.regras += rules.length;
    resumo.canais += channels.length;
    resumo.fatos += facts.length;

    for (const fact of facts) {
      const itens = planDeliveries(rules, channels, fact, at, tenant.id);
      resumo.planejados += itens.length;
      for (const item of itens) {
        if (await enqueue(item)) resumo.enfileirados++;
      }
    }
  }

  // Uma unica passada de envio, depois de tudo planejado/enfileirado.
  resumo.entregas = await dispatchPending();
  console.log(JSON.stringify(resumo));
}

main().catch((e) => {
  console.error('worker:notify FALHOU -', e);
  process.exitCode = 1;
});
