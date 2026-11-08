import { getMeta, setMeta } from '@/lib/db';

// Lingua dei CONTENUTI generati dall'AI (brief, narratives, trend, ecc.).
// Distinta dalla lingua dell'interfaccia (Fase 2). Impostazione a livello app:
// così anche la generazione lato server (cron, senza utente) sa in che lingua
// scrivere. Default inglese. NON tocca l'analisi dei dati (sentiment, topic,
// espansione semantica): quella resta agnostica alla lingua e guidata dalle
// keyword, per non alterare la base dati.
export type ContentLocale = 'en' | 'it' | 'pt';

const NAMES: Record<ContentLocale, string> = {
  en: 'English',
  it: 'Italian',
  pt: 'Brazilian Portuguese',
};

export async function getContentLocale(): Promise<ContentLocale> {
  const v = await getMeta<string>('content_locale');
  return v === 'it' || v === 'pt' ? v : 'en';
}

export async function setContentLocale(locale: ContentLocale): Promise<void> {
  await setMeta('content_locale', locale === 'it' || locale === 'pt' ? locale : 'en');
}

/**
 * Direttiva da appendere al system prompt dei generatori rivolti all'utente.
 * Traduce SOLO il testo leggibile; lascia in inglese chiavi JSON e valori enum
 * (sentiment, stance, quadranti…) così il parsing e la logica non si rompono.
 */
export function localeDirective(locale: ContentLocale): string {
  if (locale === 'en') return '';
  return `\n\nIMPORTANT: Write every human-readable text value — titles, descriptions, summaries, explanations, narratives, answers — in ${NAMES[locale]}. Keep all JSON keys and controlled enum/category values (sentiment labels, stance, quadrant names, risk levels, etc.) exactly in English.`;
}

/**
 * Le note di affidabilità dei KPI (lib/kpi-standard.ts, lib/data-reliability.ts,
 * lib/kpi-export.ts) esistono ora in it/en/pt: il portoghese riceve la traduzione
 * completa dall'Incremento 1 (revisione post-audit).
 */
export function kpiLang(locale: ContentLocale): 'it' | 'en' | 'pt' {
  return locale === 'it' ? 'it' : locale === 'pt' ? 'pt' : 'en';
}
