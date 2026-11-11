/**
 * Avaliacao de regras de notificacao (H2). Modulo PURO: sem banco, sem I/O e
 * sem relogio escondido -- toda decisao depende apenas dos argumentos.
 * Texto ao usuario em pt-BR: numero, comparacao e origem, nunca adjetivo vago
 * nem variacao temporal inventada sem historico.
 */
import type { EnqueueInput } from './queue';
import { deliveryDedupeKey, legacyDeliveryDedupeKey } from './dedupe';

// ---------------------------------------------------------------------------
// Tipos de entrada (espelham as colunas do banco sem trazer o driver junto).
// ---------------------------------------------------------------------------

/** Colunas de alert_rules necessarias para avaliar. */
export type RuleInput = {
  id: number;
  type: string;
  threshold: Record<string, unknown>;
  channels: string[];
  silencioDe: string | null;
  silencioAte: string | null;
  slaMinutes: number;
  active: number | boolean;
};

/** Colunas de notification_channels necessarias para avaliar. */
export type ChannelInput = {
  channel: string;
  destination: string;
  active: number | boolean;
  verified: number | boolean;
};

/** Um fato pontual, ja transformado pelo worker a partir das tabelas. */
export type FactInput = {
  kind: 'incident' | 'reputation' | 'billing';
  id: number | string;
  title: string;
  severity: string;
  score?: number;
  delta?: number;
  source?: string;
  ocorridoEm?: Date;
};

// ---------------------------------------------------------------------------
// Catalogos compartilhados com as rotas e o worker.
// ---------------------------------------------------------------------------

/** Tipos de regra que ruleMatches/planDeliveries entendem. */
export const RULE_TYPES: readonly string[] = ['crise_aberta', 'score_queda', 'fatura_vencida'];

/** Canais aceitos por lib/notifications/transport.ts. */
export const KNOWN_CHANNELS: readonly string[] = [
  'telegram', 'email', 'whatsapp', 'webhook', 'slack', 'ledger',
];

// ---------------------------------------------------------------------------
// Coercao segura: threshold (JSONB) e severidade (texto) vem do cliente.
// ---------------------------------------------------------------------------

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const SEVERITY_RANKS: Record<string, number> = {
  baixa: 1, low: 1,
  media: 2, medio: 2, moderada: 2, moderate: 2, medium: 2,
  alta: 3, high: 3,
  critica: 4, critico: 4, critical: 4, grave: 4,
};

function severityRank(v: unknown): number {
  const asNumber = toFiniteNumber(v);
  if (asNumber !== null) return asNumber;
  if (typeof v === 'string') return SEVERITY_RANKS[v.trim().toLowerCase()] ?? 0;
  return 0;
}

function isOn(flag: number | boolean): boolean {
  return Boolean(flag);
}

/** 'HH:mm' -> minutos desde a meia-noite, ou null se ausente/invalido. */
function parseHHmm(v: string | null): number | null {
  if (v === null) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

const NF = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
function fmt(n: number): string { return NF.format(n); }
function pontos(n: number): string { return Math.abs(n) === 1 ? 'ponto' : 'pontos'; }
function minutos(n: number): string { return n === 1 ? 'minuto' : 'minutos'; }

const KIND_LABELS: Record<FactInput['kind'], string> = {
  incident: 'Incidente', reputation: 'Reputacao', billing: 'Fatura',
};

/** Origem sempre explicita: o dado-base do fato ou, na falta, o registro. */
function origemLinha(fact: FactInput): string {
  const base = fact.source?.trim();
  return base
    ? `Base: ${base}.`
    : `Base: ${KIND_LABELS[fact.kind]} #${fact.id} - ${fact.title}.`;
}

function thresholdOf(rule: RuleInput): Record<string, unknown> {
  return rule.threshold ?? {};
}

// ---------------------------------------------------------------------------
// 1) Janela de silencio.
// ---------------------------------------------------------------------------

/**
 * Verdadeiro quando `at` cai na janela [silencioDe, silencioAte], com extremos
 * inclusivos. Usa o relogio UTC do Date: deterministico e independente do TZ
 * da maquina (o dia do dedupeKey tambem e UTC). Janelas que cruzam a
 * meia-noite (ex.: 22:00 -> 06:00) valem de `de` ate 23:59 OU de 00:00 ate
 * `ate`. Janela ausente ou invalida nunca silencia.
 */
export function isSilenced(rule: RuleInput, at: Date): boolean {
  const from = parseHHmm(rule.silencioDe);
  const to = parseHHmm(rule.silencioAte);
  if (from === null || to === null) return false;
  const now = at.getUTCHours() * 60 + at.getUTCMinutes();
  return from <= to
    ? now >= from && now <= to
    : now >= from || now <= to;
}

// ---------------------------------------------------------------------------
// 2) Matching.
// ---------------------------------------------------------------------------

/**
 * Decide se a regra dispara para o fato. `threshold` e um JSONB livre: todos
 * os numeros sao lidos por coeracao segura (number ou string numerica).
 */
export function ruleMatches(rule: RuleInput, fact: FactInput): boolean {
  const th = thresholdOf(rule);
  switch (rule.type) {
    case 'crise_aberta': {
      // Qualquer incidente ativo com severidade igual ou acima do limite.
      if (fact.kind !== 'incident') return false;
      return severityRank(fact.severity) >= severityRank(th.severity);
    }
    case 'score_queda': {
      const minScore = toFiniteNumber(th.minScore);
      const maxDelta = toFiniteNumber(th.maxDelta);
      const scoreBelow = minScore !== null && typeof fact.score === 'number'
        && Number.isFinite(fact.score) && fact.score < minScore;
      const deltaBeyond = maxDelta !== null && typeof fact.delta === 'number'
        && Number.isFinite(fact.delta) && fact.delta <= maxDelta;
      return scoreBelow || deltaBeyond;
    }
    case 'fatura_vencida':
      return fact.kind === 'billing';
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// 3) Mensagem.
// ---------------------------------------------------------------------------

/**
 * Monta titulo, corpo e severidade em pt-BR. So usa numeros presentes no fato
 * ou no threshold: nunca inventa variacao temporal ("subiu X%", "vs. ontem").
 * A comparacao e sempre contra um dado real (referencia, limite, situacao).
 */
export function buildMessage(rule: RuleInput, fact: FactInput): {
  title: string; message: string; severity: string;
} {
  const th = thresholdOf(rule);
  const severity = fact.severity.trim() || 'info';
  const origem = origemLinha(fact);
  let title: string;
  let corpo: string;

  switch (rule.type) {
    case 'score_queda': {
      const minScore = toFiniteNumber(th.minScore);
      const maxDelta = toFiniteNumber(th.maxDelta);
      const trechos: string[] = [];
      if (typeof fact.score === 'number' && Number.isFinite(fact.score)) {
        trechos.push(`Reputacao em ${fmt(fact.score)} de 100`);
        if (minScore !== null) {
          const falta = minScore - fact.score;
          trechos.push(`${fmt(falta)} ${pontos(falta)} abaixo da referencia (${fmt(minScore)})`);
        }
      }
      if (typeof fact.delta === 'number' && Number.isFinite(fact.delta)) {
        const limite = maxDelta !== null ? ` (limite ${fmt(maxDelta)})` : '';
        trechos.push(`variacao de ${fmt(fact.delta)} ${pontos(fact.delta)}${limite}`);
      }
      corpo = trechos.length
        ? trechos.join(', ')
        : `Reputacao de ${fmt(fact.score ?? fact.delta ?? 0)}`;
      title = typeof fact.score === 'number'
        ? `Reputacao em ${fmt(fact.score)} de 100`
        : `Variacao de ${fmt(fact.delta ?? 0)} ${pontos(fact.delta ?? 0)}`;
      break;
    }
    case 'crise_aberta': {
      const rank = severityRank(fact.severity);
      const limite = severityRank(th.severity);
      corpo = `Incidente #${fact.id} "${fact.title}" em severidade ${fact.severity} `
        + `(nivel ${rank}), igual ou acima do limite ${limite}; `
        + `SLA de ${fmt(rule.slaMinutes)} ${minutos(rule.slaMinutes)}`;
      title = `Incidente #${fact.id} em severidade ${fact.severity}`;
      break;
    }
    case 'fatura_vencida': {
      corpo = `Fatura #${fact.id} "${fact.title}" em situacao vencida, `
        + `diferente de "em dia" (severidade ${fact.severity}); `
        + `prazo de regularizacao (SLA) de ${fmt(rule.slaMinutes)} ${minutos(rule.slaMinutes)}`;
      title = `Fatura #${fact.id} vencida`;
      break;
    }
    default: {
      corpo = `${KIND_LABELS[fact.kind]} #${fact.id} "${fact.title}" `
        + `(severidade ${fact.severity}); SLA de ${fmt(rule.slaMinutes)} ${minutos(rule.slaMinutes)}`;
      title = `${KIND_LABELS[fact.kind]} #${fact.id}`;
      break;
    }
  }

  return { title, message: `${corpo}. ${origem}`, severity };
}

// ---------------------------------------------------------------------------
// 4) Planejamento das entregas.
// ---------------------------------------------------------------------------

/**
 * Para um fato, planeja as entregas das regras ativas, nao silenciadas e que
 * casam com o fato. Respeita `rule.channels` (vazio = todos os canais ativos
 * e verificados). dedupeKey v2 e estavel por regra, fato, dia UTC, canal
 * e DESTINO canonizado (hash, sem PII); varios destinatarios sao preservados.
 * A chave antiga segue apenas para reconciliação do histórico sem reenviar.
 *
 * `tenantId` e opcional e injetado pelo worker; quando ausente fica 0, pois
 * regras/canais/fatos ja chegam escopados por tenant. Itens prontos p/ enqueue.
 */
export function planDeliveries(
  rules: RuleInput[],
  channels: ChannelInput[],
  fact: FactInput,
  at: Date,
  tenantId = 0,
): EnqueueInput[] {
  const dia = at.toISOString().slice(0, 10); // YYYY-MM-DD (UTC), estavel por dia
  const ativos = channels.filter((c) => isOn(c.active) && isOn(c.verified));
  const itens: EnqueueInput[] = [];
  const vistos = new Set<string>();

  for (const rule of rules) {
    if (!isOn(rule.active)) continue;
    if (isSilenced(rule, at)) continue;
    if (!ruleMatches(rule, fact)) continue;

    const legacyDedupeKey = legacyDeliveryDedupeKey({ ruleId: rule.id, factKind: fact.kind, factId: fact.id, dayUtc: dia });
    const { title, message, severity } = buildMessage(rule, fact);
    const selecionados = rule.channels.length > 0
      ? ativos.filter((c) => rule.channels.includes(c.channel))
      : ativos;

    for (const canal of selecionados) {
      const dedupeKey = deliveryDedupeKey({
        ruleId: rule.id, factKind: fact.kind, factId: fact.id, dayUtc: dia,
        channel: canal.channel, destination: canal.destination,
      });
      // Hash inclui canal e destino, portanto esta dedupe local não elimina
      // pessoas distintas e elimina repetições com e-mails capitalizados.
      if (vistos.has(dedupeKey)) continue;
      vistos.add(dedupeKey);
      itens.push({
        tenantId,
        ruleId: rule.id,
        channel: canal.channel,
        destination: canal.destination,
        kind: fact.kind,
        severity,
        title,
        message,
        dedupeKey,
        legacyDedupeKey,
      });
    }
  }
  return itens;
}
