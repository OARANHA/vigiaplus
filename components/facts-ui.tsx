import Link from 'next/link';
import type { Lang } from '@/lib/kpi-standard';
import { fmtNumber } from '@/lib/kpi-standard';
import type { Signal, Verdict } from '@/lib/factcheck';
import type { Gap } from '@/lib/trials';

// ---------------------------------------------------------------------------
// I pezzi comuni delle pagine "Fatti e verifiche".
//
// Componenti senza stato, renderizzati sul server: queste pagine leggono
// dati già calcolati e non hanno niente da fare nel browser.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Glossário pt-BR para as chamadas L(lang, it, en) antigas que ainda não
// passam o 4º argumento. A chave é o fallback em inglês (3º argumento): com
// ADR-08 (pt-BR primeiro) uma tela em pt não deve cair direto no inglês só
// porque a tradução explícita falta. Cobrimos os rótulos recorrentes das
// páginas de Fatos e verificações; o que não estiver aqui continua com o
// comportamento histórico (inglês), nunca um texto inventado.
// ---------------------------------------------------------------------------
const PT_FALLBACK: Record<string, string> = {
  'No project selected.': 'Nenhum projeto selecionado.',
  'Cross-checks': 'Verificações cruzadas',
  'Riscontri': 'Verificações cruzadas',
  'Fact checks': 'Checagens de fatos',
  'Verifiche': 'Checagens de fatos',
  'Podcast': 'Podcast',
  'Podcasts': 'Podcasts',
  'Clinical trials': 'Estudos clínicos',
  'Studi clinici': 'Estudos clínicos',
  'Fact-checkers’ verdicts': 'Veredictos dos checadores',
  'NewsData.io news': 'Notícias do NewsData.io',
  'Lemmy discussions': 'Discussões no Lemmy',
  ' — not active': ' — não ativado',
  'Debunked, still circulating': 'Desmentidas, ainda circulando',
  'Debunked claims still circulating': 'Afirmações desmentidas ainda circulando',
  'Debunked claims still going around': 'Desmentidas que continuam circulando',
  'Hot topics never checked': 'Temas quentes nunca checados',
  'Hot topics with no check at all': 'Temas quentes sem nenhuma checagem',
  'News ahead of evidence': 'Notícias à frente da evidência',
  'News ahead of the evidence': 'Notícias à frente da evidência',
  'Recurring audio voices': 'Vozes recorrentes em áudio',
  'Where the news runs ahead of the evidence': 'Onde as notícias correm à frente da evidência',
  'Who talks about it every week, in audio': 'Quem fala sobre o tema toda semana, em áudio',
  'Where a correction really matters: the check exists, the conversation has not read it yet.': 'Onde uma correção realmente importa: a checagem existe, mas a conversa ainda não a leu.',
  'No debunked claim circulated in the last week.': 'Nenhuma afirmação desmentida circulou na última semana.',
  'Turn on Fact checks to see this panel.': 'Ative as Checagens de fatos para ver este painel.',
  'No show returns to the topic regularly.': 'Nenhum programa retorna ao tema com regularidade.',
  'Turn on ': 'Ative ',
  'Choose what to follow in ': 'Escolha o que acompanhar em ',
  'Mention topics are needed: they come with the AI analysis.': 'São necessários os temas das menções: eles chegam com a análise de IA.',
  'News and evidence are aligned on the treatments followed.': 'Notícias e evidências estão alinhadas nos tratamentos acompanhados.',
  'mentions': 'menções',
  'menzioni': 'menções',
  'mentions in 7 days': 'menções em 7 dias',
  'mentions in 90 days': 'menções em 90 dias',
  'trials': 'estudos',
  'studi': 'estudos',
  'max phase': 'fase máxima',
  'fase massima': 'fase máxima',
  'episodes': 'episódios',
  'episodi': 'episódios',
  'episodes (90 days)': 'episódios (90 dias)',
  'Episodes (90 days)': 'Episódios (90 dias)',
  'Shows': 'Programas',
  'Recurring shows': 'Programas recorrentes',
  'recurring': 'recorrente',
  'ricorrente': 'recorrente',
  'The shows': 'Os programas',
  'Le trasmissioni': 'Os programas',
  'Episodes': 'Episódios',
  'Minutes': 'Minutos',
  'Language': 'Idioma',
  'Languages': 'Idiomas',
  'Latest': 'Mais recente',
  'Latest episodes': 'Episódios mais recentes',
  'Hours of audio': 'Horas de áudio',
  'keep coming back to the topic': 'voltam ao tema',
  'duration of episodes that declare it': 'duração dos episódios que a declaram',
  'Checked claims': 'Afirmações checadas',
  'Conflicting verdicts': 'Veredictos divergentes',
  'Fact-checking outlets': 'Veículos de checagem',
  'Verdicts': 'Veredictos',
  'Who checked': 'Quem checou',
  'Checks over time': 'Checagens ao longo do tempo',
  'by month the check was published': 'por mês de publicação da checagem',
  'All claims': 'Todas as afirmações',
  'Those needing attention first, then the rest.': 'Primeiro as que exigem atenção, depois as demais.',
  'Attributed to': 'Atribuída a',
  'term': 'termo',
  'Circulating:': 'Em circulação:',
  'last week': 'última semana',
  'week before': 'semana anterior',
  'words searched in mentions': 'palavras buscadas nas menções',
  'Look for checks now': 'Buscar checagens agora',
  'Searching…': 'Buscando…',
  'Last search failed:': 'Última busca falhou:',
  'at least one mention in the last 7 days': 'pelo menos uma menção nos últimos 7 dias',
  'one fact-checker says true, another false': 'um checador diz verdadeiro, outro falso',
  'check': 'checagem',
  'checks': 'checagens',
  'never checked': 'nunca checado',
  'mai verificato': 'nunca checado',
  'Status': 'Status',
  'Stato': 'Status',
  'On': 'Ativo',
  'Off: no token': 'Desativado: sem token',
  'token': 'token',
  ' (from environment variable)': ' (da variável de ambiente)',
  ' (saved in Radar)': ' (salvo no VigiaPlus)',
  'Endpoint address (streamable HTTP)': 'Endereço do endpoint (streamable HTTP)',
  'How to connect it': 'Como conectar',
  'All read-only and free.': 'Todos somente leitura e sem custo.',
  'The data rules (shared by every prompt)': 'As regras de dados (comuns a todos os prompts)',
  'arguments': 'argumentos',
  'Available to admins.': 'Disponível para administradores.',
  'YOUR_TOKEN': 'SEU_TOKEN',
  'Show': 'Programa',
  'Fact-checkers disagree': 'Os checadores não concordam',
};

/**
 * L(lang, it, en, pt?) — a assinatura NÃO muda (o 4º argumento continua
 * opcional), mas em pt-BR o fallback agora tenta uma tradução genérica antes
 * de desistir e devolver o inglês.
 */
export const L = (lang: Lang, it: string, en: string, pt?: string): string => {
  if (lang === 'it') return it;
  if (lang === 'en') return en;
  return pt ?? PT_FALLBACK[en] ?? PT_FALLBACK[it] ?? en;
};

const VERDICT: Record<Verdict, { it: string; en: string; pt: string; cls: string }> = {
  false: { it: 'Falso', en: 'False', pt: 'Falso', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  misleading: { it: 'Fuorviante', en: 'Misleading', pt: 'Enganoso', cls: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  mixed: { it: 'In parte vero', en: 'Partly true', pt: 'Parcialmente verdadeiro', cls: 'bg-amber-500/15 text-amber-200 border-amber-500/30' },
  true: { it: 'Vero', en: 'True', pt: 'Verdadeiro', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  unverifiable: { it: 'Non verificabile', en: 'Unverifiable', pt: 'Não verificável', cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  contested: { it: 'Verdetti discordi', en: 'Conflicting verdicts', pt: 'Veredictos divergentes', cls: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
  other: { it: 'Altro verdetto', en: 'Other rating', pt: 'Outra classificação', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
};

export function VerdictBadge({ verdict, lang }: { verdict: string; lang: Lang }) {
  const v = VERDICT[verdict as Verdict] ?? VERDICT.other;
  return <span className={`inline-block shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${v.cls}`}>{v[lang]}</span>;
}

export const verdictLabel = (verdict: string, lang: Lang) => (VERDICT[verdict as Verdict] ?? VERDICT.other)[lang];

const SIGNAL: Record<Signal, { it: string; en: string; pt: string; cls: string }> = {
  'debunked-growing': { it: 'Smentita, e circola sempre di più', en: 'Debunked, and spreading more', pt: 'Desmentida, e circulando cada vez mais', cls: 'text-red-300' },
  'debunked-circulating': { it: 'Smentita, ma circola ancora', en: 'Debunked, still circulating', pt: 'Desmentida, mas ainda circula', cls: 'text-orange-300' },
  'debunked-quiet': { it: 'Smentita, non circola più', en: 'Debunked, no longer circulating', pt: 'Desmentida, não circula mais', cls: 'text-slate-500' },
  contested: { it: 'I fact-checker non sono d’accordo', en: 'Fact-checkers disagree', pt: 'Os fact-checkers não concordam', cls: 'text-violet-300' },
  confirmed: { it: 'Confermata', en: 'Confirmed', pt: 'Confirmada', cls: 'text-emerald-300' },
  open: { it: 'Senza un verdetto netto', en: 'No clear verdict', pt: 'Sem veredicto claro', cls: 'text-slate-400' },
};

export function SignalText({ signal, lang }: { signal: Signal; lang: Lang }) {
  const s = SIGNAL[signal];
  return <span className={`text-[11px] font-medium ${s.cls}`}>{s[lang]}</span>;
}

const GAP: Record<Gap, { it: string; en: string; pt: string; cls: string }> = {
  hype: { it: 'Notizie più avanti dell’evidenza', en: 'News ahead of the evidence', pt: 'Notícias à frente da evidência', cls: 'bg-orange-500/15 text-orange-300' },
  untold: { it: 'Evidenza che nessuno racconta', en: 'Evidence nobody covers', pt: 'Evidência que ninguém conta', cls: 'bg-sky-500/15 text-sky-300' },
  aligned: { it: 'Allineati', en: 'Aligned', pt: 'Alinhados', cls: 'bg-emerald-500/10 text-emerald-300' },
  quiet: { it: 'Silenzio', en: 'Quiet', pt: 'Silêncio', cls: 'bg-slate-500/10 text-slate-500' },
};

export function GapBadge({ gap, lang }: { gap: Gap; lang: Lang }) {
  const g = GAP[gap];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] ${g.cls}`}>{g[lang]}</span>;
}

export function Tile({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'danger' | 'warn' | 'ok';
}) {
  const color = tone === 'danger' ? 'text-red-300' : tone === 'warn' ? 'text-amber-200' : tone === 'ok' ? 'text-emerald-300' : 'text-slate-100';
  return (
    <div className="panel px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p>}
    </div>
  );
}

/** Barre orizzontali essenziali: etichetta, barra, numero. */
export function Bars({ items, lang, color = 'bg-sky-500/60' }: {
  items: { label: string; value: number; color?: string }[]; lang: Lang; color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((i) => (
        <li key={i.label} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-slate-300" title={i.label}>{i.label}</span>
          <span className="h-2 rounded-full bg-white/5">
            <span className={`block h-2 rounded-full ${i.color ?? color}`} style={{ width: `${Math.max(2, (i.value / max) * 100)}%` }} />
          </span>
          <span className="tabular-nums text-slate-400">{fmtNumber(i.value, lang)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Link ad Ascolto con esattamente le menzioni che provano un'affermazione. */
export function MentionsLink({ ids, count, lang }: { ids: number[]; count: number; lang: Lang }) {
  if (!ids.length) return null;
  return (
    <Link href={`/listening?ids=${ids.join(',')}`} className="text-[11px] text-sky-300 hover:underline">
      {L(lang, `vedi ${count > ids.length ? `le ${ids.length} più viste su ${fmtNumber(count, lang)}` : `le ${ids.length} menzioni`}`,
        `see ${count > ids.length ? `the top ${ids.length} of ${fmtNumber(count, lang)}` : `the ${ids.length} mentions`}`,
        `ver ${count > ids.length ? `as ${ids.length} mais vistas de ${fmtNumber(count, lang)}` : `as ${ids.length} menções`}`)} →
    </Link>
  );
}

export function Section({ title, hint, children, className = '' }: {
  title: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`panel px-5 py-4 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}
