import type { RawMention } from '@/lib/connectors/types';

export const PILOT_KEY = 'crfrs-reputation-communication';
export const PILOT_NAME = 'CRF-RS — Reputação e Comunicação';
export const SUPPORTED_SOURCES = ['googlenews', 'gdelt', 'rss'] as const;
export type PilotSource = typeof SUPPORTED_SOURCES[number];
export type EntityKey = 'giovana' | 'funcionarios' | 'crfrs';

export const PILOT_ENTITIES: { key: EntityKey; name: string; terms: string[] }[] = [
  { key: 'giovana', name: 'Giovana Ranquetat Fernandes',
    terms: ['Giovana Ranquetat Fernandes', 'Giovana Ranquetat', 'giovanaranquetat'] },
  { key: 'funcionarios', name: 'Funcionários CRF-RS',
    terms: ['funcionarioscrfrs', 'funcionários CRF-RS', 'funcionarios CRF RS'] },
  { key: 'crfrs', name: 'CRF-RS',
    terms: ['CRF-RS', 'CRF/RS', 'CRF RS', 'crfrs.org.br',
      'Conselho Regional de Farmácia do Rio Grande do Sul'] },
];

const fold = (value: string): string => value.normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

/** Somente coincidências explícitas. Não inferir opiniões ou clima interno. */
export function classifyEntities(mention: Pick<RawMention, 'title' | 'content' | 'url'>): EntityKey[] {
  const original = [mention.title, mention.content, mention.url].filter(Boolean).join(' ');
  const compact = fold(original);
  const joined = ' ' + compact + ' ';
  const found: EntityKey[] = [];
  if (joined.includes(' giovana ranquetat ') || joined.includes(' giovanaranquetat ')
      || joined.includes(' giovana ranquetat fernandes ')) found.push('giovana');
  if (joined.includes(' funcionarioscrfrs ') ||
      joined.includes(' funcionarios crf rs ') ||
      joined.includes(' funcionarios do crf rs ')) found.push('funcionarios');
  if (joined.includes(' crf rs ') || joined.includes(' crfrs org br ') ||
      joined.includes(' conselho regional de farmacia do rio grande do sul ') ||
      joined.includes(' conselho regional de farmacia do rs ')) found.push('crfrs');
  return found;
}

/** Normaliza apenas aspectos seguros da URL: jamais apaga parâmetros editoriais. */
export function canonicalArticleUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    if (!url.hostname || url.username || url.password) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|igshid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
}

export function validateSourceIds(input: unknown): PilotSource[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((x): x is PilotSource =>
    typeof x === 'string' && SUPPORTED_SOURCES.includes(x as PilotSource)))];
}

export function discardReason(m: RawMention, now = Date.now()): string | null {
  if (!m.externalId || !m.title || !m.url || !canonicalArticleUrl(m.url)) return 'sem_identificador_ou_url';
  const time = m.publishedAt?.getTime();
  if (!Number.isFinite(time)) return 'data_invalida';
  if (time > now + 3600_000 || time < now - 90 * 86400_000) return 'fora_da_janela';
  if (classifyEntities(m).length === 0) return 'sem_entidade_verificada';
  return null;
}

/** Logs não contêm URL completa, token, cookie nem cabeçalhos sensíveis. */
export function safeSourceError(error: unknown): { message: string; httpStatus: number | null } {
  const raw = error instanceof Error ? error.message : String(error);
  const status = raw.match(/\bHTTP\s+(\d{3})\b/i);
  return {
    httpStatus: status ? Number(status[1]) : null,
    message: raw.replace(/https?:\/\/\S+/gi, '[url omitida]')
      .replace(/(bearer|token|api[_-]?key|cookie|secret)\s*[:=]\s*\S+/gi, '$1=[redigido]')
      .slice(0, 220),
  };
}
