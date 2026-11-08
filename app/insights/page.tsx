import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import {
  Activity, Boxes, Gauge, Globe2, Grid3x3, HeartPulse, LayoutGrid, Orbit, Scale,
  ScatterChart, ShieldAlert, Sparkles, Triangle, TrendingDown, Waypoints, Network, Workflow,
} from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { fmt } from '@/lib/i18n-dict';
import { getDb } from '@/lib/db';
import { studioCharts } from '@/lib/db/schema';
import { getCurrentProject } from '@/lib/data';
import { fieldLabel, type StudioSpec } from '@/lib/studio';
import { InsightStudioCards } from '@/components/insight-studio-cards';

export const metadata = { title: 'Explore insights' };
export const dynamic = 'force-dynamic';

// Hub degli insight: 16 visualizzazioni raggruppate per DOMANDA a cui rispondono.
// In elenco nel menu erano illeggibili (metà delle voci) e il nome da solo non
// diceva a cosa servissero: qui ognuna arriva con la sua domanda.
// Le etichette vivono nel dizionario (ins.hub.*): la stessa pagina serve
// en/it/pt senza duplicare la struttura.
const GROUPS: {
  titleKey: string;
  hintKey: string;
  items: { href: string; labelKey: string; fallbackLabel: string; icon: typeof Activity; questionKey: string }[];
}[] = [
  {
    titleKey: 'ins.hub.g1',
    hintKey: 'ins.hub.g1h',
    items: [
      { href: '/insights/topics', labelKey: 'ins.topics.title', fallbackLabel: 'Topics × Sentiment', icon: ScatterChart, questionKey: 'ins.hub.q.topics' },
      { href: '/insights/constellation', labelKey: 'ins.constellation.title', fallbackLabel: 'Semantic constellation', icon: Sparkles, questionKey: 'ins.hub.q.constellation' },
      { href: '/insights/flow', labelKey: 'ins.flow.title', fallbackLabel: 'Conversation flow', icon: Waypoints, questionKey: 'ins.hub.q.flow' },
      { href: '/insights/clusters', labelKey: 'ins.clusters.title', fallbackLabel: 'Conversation clusters', icon: Boxes, questionKey: 'ins.hub.q.clusters' },
    ],
  },
  {
    titleKey: 'ins.hub.g2',
    hintKey: 'ins.hub.g2h',
    items: [
      { href: '/insights/network', labelKey: 'ins.network.title', fallbackLabel: 'Influencer network', icon: Network, questionKey: 'ins.hub.q.network' },
      { href: '/insights/pyramid', labelKey: 'ins.pyramid.title', fallbackLabel: 'Author pyramid', icon: Triangle, questionKey: 'ins.hub.q.pyramid' },
    ],
  },
  {
    titleKey: 'ins.hub.g3',
    hintKey: 'ins.hub.g3h',
    items: [
      { href: '/insights/health', labelKey: 'ins.hub.l.health', fallbackLabel: 'Health Index', icon: Gauge, questionKey: 'ins.hub.q.health' },
      { href: '/insights/momentum', labelKey: 'ins.hub.l.momentum', fallbackLabel: 'Momentum quadrant', icon: LayoutGrid, questionKey: 'ins.hub.q.momentum' },
      { href: '/insights/sov', labelKey: 'ins.hub.l.sov', fallbackLabel: 'Share of Voice', icon: Activity, questionKey: 'ins.hub.q.sov' },
      { href: '/insights/waterfall', labelKey: 'ins.hub.l.waterfall', fallbackLabel: 'Sentiment waterfall', icon: TrendingDown, questionKey: 'ins.hub.q.waterfall' },
      { href: '/insights/emotions', labelKey: 'ins.hub.l.emotions', fallbackLabel: 'Emotion radar', icon: HeartPulse, questionKey: 'ins.hub.q.emotions' },
    ],
  },
  {
    titleKey: 'ins.hub.g4',
    hintKey: 'ins.hub.g4h',
    items: [
      { href: '/insights/heatmap', labelKey: 'ins.hub.l.heatmap', fallbackLabel: 'Hourly heatmap', icon: Grid3x3, questionKey: 'ins.hub.q.heatmap' },
    ],
  },
  {
    titleKey: 'ins.hub.g5',
    hintKey: 'ins.hub.g5h',
    items: [
      { href: '/insights/owned', labelKey: 'ins.hub.l.owned', fallbackLabel: 'Owned vs Earned', icon: Scale, questionKey: 'ins.hub.q.owned' },
    ],
  },
  {
    titleKey: 'ins.hub.g6',
    hintKey: 'ins.hub.g6h',
    items: [
      { href: '/insights/crisis', labelKey: 'ins.hub.l.crisis', fallbackLabel: 'Crisis radar', icon: ShieldAlert, questionKey: 'ins.hub.q.crisis' },
      { href: '/insights/causal', labelKey: 'ins.hub.l.causal', fallbackLabel: 'Cause & effect', icon: Workflow, questionKey: 'ins.hub.q.causal' },
    ],
  },
  {
    titleKey: 'ins.hub.g7',
    hintKey: 'ins.hub.g7h',
    items: [
      { href: '/insights/galaxy', labelKey: 'ins.hub.l.galaxy', fallbackLabel: 'Conversation Galaxy', icon: Orbit, questionKey: 'ins.hub.q.galaxy' },
    ],
  },
];

/** Fallback inglesi delle chiavi del dizionario (il locale en li usa). */
const GROUP_FALLBACKS: Record<string, string> = {
  "ins.hub.g1": "Shape of the conversation",
  "ins.hub.g1h": "What is being talked about, and how the themes hang together",
  "ins.hub.g2": "People",
  "ins.hub.g2h": "Who carries the conversation",
  "ins.hub.g3": "Momentum & health",
  "ins.hub.g3h": "Where it is heading, and how healthy it is",
  "ins.hub.g4": "Context",
  "ins.hub.g4h": "Where and when it happens",
  "ins.hub.g5": "Your channels",
  "ins.hub.g5h": "How your own posts do, against everything said about you",
  "ins.hub.g6": "Risk",
  "ins.hub.g6h": "What could go wrong, and what caused what",
  "ins.hub.g7": "The whole picture",
  "ins.hub.g7h": "Everything at once, for a wall or a demo",
  "ins.hub.q.topics": "Which themes are big, which are loved or hated, which are growing?",
  "ins.hub.q.constellation": "Which words travel together, and with what tone?",
  "ins.hub.q.flow": "Which source feeds which topic, and how does it end up in sentiment?",
  "ins.hub.q.clusters": "Which families of discourse (the framings) split the conversation?",
  "ins.hub.q.network": "Who are the loudest voices, and which topic tribes do they form?",
  "ins.hub.q.pyramid": "Is reach concentrated in a few big voices or spread widely?",
  "ins.hub.q.health": "One 0–100 score: how healthy is the conversation — and your brand in it?",
  "ins.hub.q.momentum": "Which topics are rising stars and which are fading?",
  "ins.hub.q.sov": "How much of the conversation does each player own over time?",
  "ins.hub.q.waterfall": "Day by day, what pushed the mood up or down?",
  "ins.hub.q.emotions": "Beyond positive/negative: joy, trust, fear, anger, sadness, surprise?",
  "ins.hub.q.heatmap": "Which days and hours does the conversation actually live?",
  "ins.hub.q.owned": "Are your own posts working, or is the conversation happening entirely without you?",
  "ins.hub.q.crisis": "How exposed are you right now, and what drove the last spike?",
  "ins.hub.q.causal": "Which events produced measurable consequences?",
  "ins.hub.q.galaxy": "The entire conversation as a living solar system.",
};

export default async function InsightsHubPage() {
  const t = await getT();
  const total = GROUPS.reduce((s, g) => s + g.items.length, 0);

  // I grafici costruiti in Studio Graph da chi usa questo progetto. La domanda
  // a cui rispondono non la scrive nessuno: la si legge dagli assi, che è
  // esattamente ciò che il grafico è.
  const project = await getCurrentProject();
  let mine: { id: number; title: string; question: string }[] = [];
  if (project) {
    const db = await getDb();
    const rows = await db.select().from(studioCharts)
      .where(eq(studioCharts.projectId, project.id))
      .orderBy(desc(studioCharts.updatedAt));
    mine = rows.map((r) => {
      const spec = r.spec as unknown as StudioSpec;
      const src = spec.source === 'metrics' ? 'metrics' : 'mentions';
      const parts = [
        `${fieldLabel(src, spec.y)} per ${fieldLabel(src, spec.x)}`,
        ...(spec.z ? [`diviso per ${fieldLabel(src, spec.z)}`] : []),
        `ultimi ${spec.days} giorni`,
      ];
      return { id: r.id, title: r.title, question: `${parts.join(' · ')}.` };
    });
  }
  return (
    <>
      <PageHeader
        title={t('page.insights.title', 'Explore insights')}
        info={fmt(t('ins.hub.info', `All ${total} advanced visualizations, grouped by the question they answer rather than by chart type. Each one runs on the mentions your project has collected; the AI-powered ones (clusters, cause & effect) are generated on demand and cached for the day.`), { n: total })}
        subtitle={fmt(t('ins.hub.subtitle', `${total} ways to read the same conversation, grouped by the question you are trying to answer. Every card says what it is for — pick the question, not the chart.`), { n: total, extra: mine.length ? fmt(t('ins.hub.mineExtra', `, plus ${mine.length} you built`), { n: mine.length }) : '' })}
      />
      <div className="flex flex-col gap-6">
        {mine.length > 0 && (
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-slate-200">{t('ins.hub.mine', 'Your charts')}</h2>
              <span className="text-[11px] text-slate-600">
                {t('ins.hub.mineHint', 'built by you in')} <Link href="/graph" className="text-violet-400 hover:underline">Studio Graph</Link> — {t('ins.hub.mineOnly', 'only these can be removed')}
              </span>
            </div>
            <InsightStudioCards charts={mine} />
          </section>
        )}

        {GROUPS.map((g) => (
          <section key={g.titleKey}>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-sm font-semibold text-slate-200">{t(g.titleKey, GROUP_FALLBACKS[g.titleKey] ?? g.titleKey)}</h2>
              <span className="text-[11px] text-slate-600">{t(g.hintKey, GROUP_FALLBACKS[g.hintKey] ?? g.hintKey)}</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} title={t(it.questionKey, GROUP_FALLBACKS[it.questionKey] ?? it.questionKey)}
                  className="panel group flex items-start gap-3 px-4 py-3 transition hover:border-sky-500/40 hover:bg-sky-500/[0.04]">
                  <it.icon className="mt-0.5 size-4 shrink-0 text-sky-400" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-200 transition group-hover:text-sky-200">{t(it.labelKey, it.fallbackLabel)}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{t(it.questionKey, GROUP_FALLBACKS[it.questionKey] ?? it.questionKey)}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
