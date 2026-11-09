import type { ListeningQuery, RawMention } from '@/lib/connectors/types';
import { canonicalArticleUrl } from './core';

/** Regras explícitas, independentes do piloto CRF-RS. */
export type GenericEntity = { id: number; name: string; keywords: string[] };
export type GenericWatch = {
  keywords: string[]; allTerms: string[]; excludeTerms: string[];
  languages: string[]; countries: string[]; rssFeeds: string[];
};

function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function validTerms(input: unknown, cap = 48): string[] {
  if (!Array.isArray(input)) return [];
  const result: string[] = [], seen = new Set<string>();
  for (const term of input) {
    if (typeof term !== 'string') continue;
    const key = fold(term);
    if (key.length < 3 || key.length > 100 || seen.has(key)) continue;
    seen.add(key);
    result.push(term.trim());
    if (result.length >= cap) break;
  }
  return result;
}

export function projectQuery(project: GenericWatch, entities: readonly GenericEntity[]): ListeningQuery {
  const entityTerms = entities.flatMap((e) => validTerms(e.keywords.length ? e.keywords : [e.name], 8));
  return {
    anyTerms: validTerms([...project.keywords, ...entityTerms], 12),
    allTerms: validTerms(project.allTerms, 8),
    excludeTerms: validTerms(project.excludeTerms, 8),
    languages: project.languages ?? [], countries: project.countries ?? [],
    rssFeeds: project.rssFeeds ?? [], strict: true,
  };
}

export function explicitlyMatches(text: string, term: string): boolean {
  const phrase = fold(term);
  if (phrase.length < 3) return false;
  return (' ' + fold(text) + ' ').includes(' ' + phrase + ' ');
}

export function matchingEntityIds(mention: Pick<RawMention, 'title' | 'content'>, entities: readonly GenericEntity[]): number[] {
  const text = [mention.title, mention.content].filter(Boolean).join(' ');
  return entities.filter((entity) => {
    const terms = validTerms(entity.keywords.length ? entity.keywords : [entity.name], 8);
    return terms.some((term) => explicitlyMatches(text, term));
  }).map((entity) => entity.id);
}

/** Feed explícito pode operar sem palavras-chave; buscas abertas nunca. */
export function genericDiscardReason(
  mention: RawMention, project: GenericWatch, entities: readonly GenericEntity[], now = Date.now(),
): string | null {
  if (!mention.externalId || !mention.title || !mention.url || !canonicalArticleUrl(mention.url)) {
    return 'sem_identificador_ou_url';
  }
  const published = mention.publishedAt?.getTime();
  if (!Number.isFinite(published)) return 'data_invalida';
  if (published > now + 3_600_000 || published < now - 90 * 86_400_000) return 'fora_da_janela';
  const query = projectQuery(project, entities);
  const text = [mention.title, mention.content].filter(Boolean).join(' ');
  if (query.excludeTerms.some((term) => explicitlyMatches(text, term))) return 'termo_excluido';
  if (!query.allTerms.every((term) => explicitlyMatches(text, term))) return 'termo_obrigatorio_ausente';
  const anyMatched = query.anyTerms.some((term) => explicitlyMatches(text, term));
  const rssExplicit = mention.source === 'rss' && project.rssFeeds.length > 0 &&
    query.anyTerms.length === 0 && query.allTerms.length === 0;
  if (!anyMatched && !rssExplicit && query.anyTerms.length > 0) return 'sem_termo_do_projeto';
  if (!anyMatched && !rssExplicit && query.anyTerms.length === 0 && query.allTerms.length === 0) {
    return 'sem_criterio_de_relevancia';
  }
  return null;
}
