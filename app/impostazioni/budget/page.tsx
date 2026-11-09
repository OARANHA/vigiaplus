import { getConnectorCredStatuses, hydrateConnectorCredentials } from '@/lib/connector-credentials';
import { CONNECTORS } from '@/lib/connectors';
import { SOURCE_META } from '@/lib/connectors';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { CostControl } from '@/components/cost-control';
import { AiEngine, type EngineOption } from '@/components/ai-engine';
import { claudeAvailable, costControl } from '@/lib/claude';
import { AI_PROVIDERS, AI_PROVIDER_IDS, aiProvider, aiModels } from '@/lib/ai-provider';
import { PageHeader } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { ExternalLink } from 'lucide-react';

export const metadata = { title: 'Orçamento' };

// How each paid connector is billed — by the provider, not metered by Radar.
const PAID_NOTE: Record<string, string> = {
  x: "API do X. Preço e franquia dependem do plano contratado diretamente com o provedor.",
  newsapi: "NewsAPI oferece planos de desenvolvimento e comerciais; a cobrança é feita pelo provedor.",
  instagram: "API Meta Graph. Exige conta profissional e permissões compatíveis; verifique as condições atuais da Meta.",
  facebook: "API Meta Graph vinculada às páginas e tokens autorizados. Verifique as condições do provedor.",
  tiktok: "API de pesquisa do TikTok, sujeita à análise e autorização do serviço.",
  linkedin: "API LinkedIn, geralmente restrita ao conteúdo da organização autorizada.",
};

export default async function BudgetPage() {
  const t = await getT();
  await hydrateConnectorCredentials();
  const [cost, credStatuses, currentUser, activeProvider] = await Promise.all([
    costControl(), getConnectorCredStatuses(), getCurrentUser(), aiProvider(),
  ]);
  const isAdm = isAdmin(currentUser);
  const engineOptions: EngineOption[] = await Promise.all(AI_PROVIDER_IDS.map(async (id) => ({
    id,
    label: AI_PROVIDERS[id].label,
    configured: credStatuses[id]?.configured ?? false,
    fields: credStatuses[id]?.fields ?? [],
    models: await aiModels(id),
    defaults: AI_PROVIDERS[id].models,
  })));
  const budget = cost.budget;
  const budgetPct = Math.min(100, (cost.current.cost / budget) * 100);

  const paidActive = CONNECTORS
    .filter((c) => c.tier === 'premium')
    .filter((c) => credStatuses[c.id]?.fields.some((f) => f.set));

  return (
    <>
      <PageHeader
        title={t('page.budget.title', 'Orçamento e custos')}
        subtitle={t('h5.budget.subtitle', 'Controle dos custos de IA e condições comerciais das fontes de dados.')}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Colonna AI: chiave + spesa/budget */}
        <div className="flex flex-col gap-4">
          {isAdm && (
            <AiEngine options={engineOptions} active={activeProvider} />
          )}

          <section className="panel h-fit px-5 py-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-300">{t('h5.budget.aiSpend', 'Custos e limite de IA')}</h2>
            {await claudeAvailable() ? (
              <>
                <div className="flex items-baseline gap-2">
                  <p className="text-3xl font-bold">${cost.current.cost.toFixed(2)}</p>
                  <p className="text-sm text-slate-500">de ${budget.toFixed(2)} — desde o último reinício</p>
                </div>
                <div className="mt-2 h-2 rounded bg-white/5">
                  <div
                    className={`h-2 rounded ${budgetPct > 85 ? 'bg-red-400' : budgetPct > 60 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                    style={{ width: `${budgetPct}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {cost.current.calls.toLocaleString('pt-BR')} chamadas · {(cost.current.inTok / 1000).toFixed(0)} mil tokens de entrada · {(cost.current.outTok / 1000).toFixed(0)} mil tokens de saída.
                  Ao atingir o limite, as chamadas de IA são interrompidas; a coleta de dados continua.
                </p>
                {cost.byPurpose.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {cost.byPurpose.map((p) => (
                      <div key={p.purpose} className="flex justify-between text-xs">
                        <span className="text-slate-400">{p.purpose.replace(/_/g, ' ')}</span>
                        <span className="text-slate-500">${p.cost.toFixed(3)} · {p.calls} chamadas</span>
                      </div>
                    ))}
                  </div>
                )}
                {isAdm && (
                  <CostControl
                    budget={cost.budget}
                    lifetimeCost={cost.lifetime.cost}
                    lifetimeCalls={cost.lifetime.calls}
                    resetAt={cost.resetAt}
                  />
                )}
              </>
            ) : (
              <p className="text-sm text-amber-400/90">
                {t('h5.budget.noKey', 'O mecanismo de IA selecionado está sem chave. A coleta funciona, mas análises e relatórios gerados por IA ficam pendentes.')}
              </p>
            )}
          </section>
        </div>

        {/* Colonna costi delle fonti a pagamento */}
        <section className="panel h-fit px-5 py-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-300">{t('h5.budget.paidSources', 'Fontes de dados com custos')}</h2>
          <p className="mb-3 text-[11px] leading-relaxed text-slate-600">
            {t('h5.budget.paidHint', 'O orçamento de IA considera apenas o consumo medido pelo VigiaPlus. Fontes externas podem gerar despesas cobradas pelos respectivos provedores. Consulte o contrato e os limites diretamente no serviço.')}
          </p>

          {paidActive.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/80">Configuradas nesta conta</p>
              {paidActive.map((c) => (
                <div key={c.id} className="rounded-lg border border-[var(--border)] bg-white/[0.02] px-3 py-2">
                  <p className="text-sm font-medium text-slate-200">{SOURCE_META[c.id]?.label ?? c.id}</p>
                  <p className="text-[11px] leading-snug text-slate-500">{PAID_NOTE[c.id] ?? 'Cobrança e limites definidos pelo provedor.'}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">
              Nenhuma fonte paga está configurada. Verifique o consumo de IA no painel ao lado.
            </p>
          )}

          <div className="mt-4 flex flex-col gap-1.5 border-t border-[var(--border)] pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">Referência sobre custos e condições das fontes</p>
            {(['x', 'newsapi', 'instagram', 'facebook', 'tiktok', 'linkedin'] as const).map((id) => (
              <p key={id} className="text-[11px] text-slate-500">
                <span className="text-slate-300">{SOURCE_META[id]?.label ?? id}:</span> {PAID_NOTE[id]}
              </p>
            ))}
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-600">
              Gerencie as credenciais na aba <span className="text-sky-400">Fontes</span>. <ExternalLink className="size-3" />
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
