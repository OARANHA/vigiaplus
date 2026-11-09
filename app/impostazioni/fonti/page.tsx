import { Info } from 'lucide-react';
import { getMeta } from '@/lib/db';
import { getCurrentProject } from '@/lib/data';
import {
  CONNECTORS, SOURCE_CATEGORY, CATEGORY_ORDER, type SourceCategory,
} from '@/lib/connectors';
import { getConnectorCredStatuses, hydrateConnectorCredentials, type ConnectorCredStatus } from '@/lib/connector-credentials';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { ConnectorKeys } from '@/components/connector-keys';
import { PageHeader, fmtDate } from '@/components/ui';
import { getT } from '@/lib/i18n';
import type { SourceStatus } from '@/lib/ingest';

export const metadata = { title: 'Fontes de dados' };

const CATEGORY_LABEL_PT: Record<SourceCategory, string> = {
  general: 'Notícias e fontes gerais',
  finance: 'Finanças e empresas',
  academic: 'Produção acadêmica',
  tech: 'Tecnologia e desenvolvimento',
  social: 'Redes sociais e mensagens',
  video: 'Vídeos',
  audio: 'Podcasts e áudio',
};

function sourceDisabledMessage(reason: string | undefined): string {
  if (!reason) return 'Fonte indisponível';
  if (/key|token|credential|chave|api key|access_token|secret/i.test(reason)) {
    return 'Chave ou token não configurado';
  }
  if (/plan|paid|premium|payment|subscription/i.test(reason)) {
    return 'Requer plano ou permissão do provedor';
  }
  return 'Fonte não habilitada';
}


// What each source is and what data Radar collects from it: shown in the hover tooltip.
const SOURCE_INFO: Record<string, string> = {
  googlenews: "Agregador de notícias do Google. Reúne matérias públicas relacionadas aos termos monitorados, com título, veículo e data.",
  gdelt: "Índice internacional de notícias. Pesquisa matérias em diversos idiomas e países, conforme os termos configurados.",
  reddit: "Discussões públicas em comunidades do Reddit. Inclui publicações, comentários, votos e informações da comunidade, quando disponíveis.",
  bluesky: "Rede social aberta baseada no protocolo AT. Busca publicações públicas por termos, com autoria e interações disponíveis.",
  mastodon: "Rede social federada. Consulta publicações em instâncias acessíveis que mencionem os termos monitorados.",
  hackernews: "Comunidade de tecnologia. Reúne notícias e comentários relacionados aos termos, com pontuação e discussão.",
  youtube: "Vídeos públicos do YouTube, com título, canal, data e métricas disponíveis. Exige uma chave de API do Google.",
  telegram: "Acompanha somente canais públicos informados no projeto. Não realiza busca em todo o Telegram.",
  rss: "Feeds RSS/Atom cadastrados no projeto. Coleta conteúdos dos endereços configurados, respeitando limites e disponibilidade da fonte.",
  x: "Publicações do X por termos monitorados. Exige acesso autorizado à API e pode estar sujeito a cobrança.",
  instagram: "Consulta hashtags pela API Meta Graph, sujeita a permissões e conta profissional compatível.",
  facebook: "Publicações das páginas associadas ao token autorizado, incluindo interações fornecidas pela API.",
  tiktok: "Vídeos públicos pela API de pesquisa do TikTok, sujeita à aprovação e às regras de acesso.",
  linkedin: "Conteúdo da página corporativa autorizada pela API LinkedIn. Não oferece busca geral de publicações de terceiros.",
  linkedin_web: "Resultados públicos indexados pelo Tavily, com trechos e links para a origem. Não inclui métricas de interação do LinkedIn.",
  newsapi: "Agregador de notícias com consultas por palavras-chave. Requer credencial e respeita limites do plano contratado.",
  stackexchange: "Perguntas públicas do Stack Exchange, incluindo Stack Overflow, localizadas por título. A cota sem chave é limitada.",
  github: "Issues e pull requests públicos encontrados pelos termos. O limite de consultas anônimas é reduzido; pode exigir GITHUB_TOKEN.",
  discord: "Mensagens dos canais de servidores administrados por você, com bot autorizado e permissão de leitura de mensagens.",
  "sec-edgar": "Documentos de empresas listadas nos Estados Unidos disponíveis nos registros oficiais da SEC, com metadados e link para leitura.",
  arxiv: "Publicações acadêmicas da API arXiv, com resumos disponíveis. Resultados são filtrados para verificar relevância literal.",
};

export default async function FontiPage() {
  const t = await getT();
  // Hydrate saved keys before reading the "active" status of the connectors.
  await hydrateConnectorCredentials();
  const project = await getCurrentProject();
  const [sourceStatus, credStatuses, currentUser] = await Promise.all([
    project ? getMeta<SourceStatus>('source_status_' + project.id) : Promise.resolve(null),
    getConnectorCredStatuses(), getCurrentUser(),
  ]);
  const canEditKeys = isAdmin(currentUser);

  return (
    <>
      <PageHeader
        title={t('page.sources.title', 'Fontes')}
        subtitle="Situação das fontes e suas credenciais. Custos de IA e orçamento ficam na aba Orçamento."
      />

      <div className="max-w-3xl">
        <section className="panel px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Situação das fontes</h2>

          <TierSection
            heading="Gratuitas" headingClass="text-emerald-400/80"
            connectors={CONNECTORS.filter((c) => c.tier === 'free')}
            sourceStatus={sourceStatus} credStatuses={credStatuses} canEditKeys={canEditKeys} showKeys={false}
          />
          <TierSection
            heading="Gratuitas com chave" headingClass="text-sky-400/80"
            description="Exigem uma chave gratuita cadastrada no serviço. Informe a credencial para habilitar o conector."
            connectors={CONNECTORS.filter((c) => c.tier === 'freekey')}
            sourceStatus={sourceStatus} credStatuses={credStatuses} canEditKeys={canEditKeys} showKeys
          />
          <TierSection
            heading="Pagas ou restritas" headingClass="text-amber-400/80"
            description={<>Cadastre as credenciais autorizadas sem alterar o código. As configurações de fonte podem valer para toda a conta.
              Os custos dependem de cada provedor; consulte a aba <span className="text-slate-400">Orçamento</span>.</>}
            connectors={CONNECTORS.filter((c) => c.tier === 'premium')}
            sourceStatus={sourceStatus} credStatuses={credStatuses} canEditKeys={canEditKeys} showKeys
          />
        </section>
      </div>
    </>
  );
}

/**
 * Un livello (gratis / gratis con chiave / a pagamento), suddiviso per
 * categoria tematica al suo interno. Le tre sezioni della pagina erano
 * identiche a parte lo "showKeys": tenerle come un unico componente evita
 * di ripetere tre volte la stessa logica di raggruppamento.
 */
function TierSection({ heading, headingClass, description, connectors, sourceStatus, credStatuses, canEditKeys, showKeys }: {
  heading: string; headingClass: string; description?: React.ReactNode;
  connectors: (typeof CONNECTORS)[number][];
  sourceStatus?: SourceStatus | null; credStatuses: Record<string, ConnectorCredStatus>;
  canEditKeys: boolean; showKeys: boolean;
}) {
  if (connectors.length === 0) return null;
  const byCategory = CATEGORY_ORDER
    .map((cat) => ({ cat, items: connectors.filter((c) => (SOURCE_CATEGORY[c.id] as SourceCategory | undefined) === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="mt-4 first:mt-0">
      <p className={`mb-2 text-[10px] font-semibold uppercase tracking-widest ${headingClass}`}>{heading}</p>
      {description && <p className="mb-2 text-[11px] text-slate-600">{description}</p>}
      <div className="flex flex-col gap-3">
        {byCategory.map(({ cat, items }) => (
          <div key={cat}>
            {byCategory.length > 1 && (
              <p className="mb-1.5 text-[10px] font-medium text-slate-600">{CATEGORY_LABEL_PT[cat]}</p>
            )}
            <div className="flex flex-col gap-2">
              {items.map((c) => (
                <div key={c.id}>
                  <SourceRow c={c} st={sourceStatus?.[c.id]} />
                  {showKeys && canEditKeys && credStatuses[c.id] && (
                    <ConnectorKeys connectorId={c.id} fields={credStatuses[c.id].fields} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Status row for a source: dot, name, last-collection outcome. */
function SourceRow({ c, st }: {
  c: (typeof CONNECTORS)[number];
  st?: SourceStatus[string];
}) {
  const enabled = c.enabled();
  // Amber = temporary hiccup (last run failed but it collected within the last
  // 24h, typical of GDELT's shared rate limit); red = genuinely down.
  const recentOk = st?.lastOkAt && Date.now() - new Date(st.lastOkAt).getTime() < 24 * 3600_000;
  const dot = !enabled
    ? 'bg-red-400/70'
    : st?.ok === false
      ? (recentOk ? 'bg-amber-400' : 'bg-red-400')
      : 'bg-emerald-400';
  const info = SOURCE_INFO[c.id];
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="group relative flex w-32 shrink-0 items-center gap-1">
        <span className="truncate">{c.label}</span>
        {info && (
          <>
            <Info className="size-3 shrink-0 cursor-help text-slate-600 transition group-hover:text-sky-400" />
            <span
              role="tooltip"
              className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 hidden w-64 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2.5 text-[11px] font-normal leading-relaxed text-slate-300 shadow-xl group-hover:block"
            >
              <span className="mb-1 block font-semibold text-slate-100">{c.label}</span>
              {info}
            </span>
          </>
        )}
      </span>
      <span className="truncate text-xs text-slate-500" title={!enabled ? c.disabledReason : st?.ok === false ? st.error : undefined}>
        {!enabled
          ? sourceDisabledMessage(c.disabledReason)
          : st
            ? st.ok
              ? `${st.count} novas · ${fmtDate(st.at)}`
              : recentOk
                ? `temporariamente indisponível · última coleta bem-sucedida ${fmtDate(st.lastOkAt!)}`
                : `erro: ${st.error}`
            : 'aguardando primeira coleta'}
      </span>
    </div>
  );
}
