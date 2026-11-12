'use client';
import { useState, useEffect } from 'react';
import { ViewModeToggle } from '@/components/view-mode-toggle';

// Portal do cliente: 4 abas que respondem as 4 perguntas em 30s.
// Panorama, Crises, Relatorios, Conta (com Plano e Avisos dentro).
//
// Quando o dono esta em "visao de carteira" (system=true, sem tenant ativo),
// o portal mostra um seletor de cliente para ele conferir exatamente o que
// cada contrato enxerga. E a mesma tela do cliente, so que com o tenant escolhido.

type TenantOption = { id: number; name: string; plan?: string };

type CompositionItem = {
  key: string;
  label: string;
  technical: string;
  weight: number;
};

type Reputation = {
  id: number;
  kind: string;
  name: string;
  score: number | null;
  headline: string;
  comparison?: { delta: number | null; reference: string; temporal_note?: string } | null;
  provenance: {
    comments: number;
    sources: number;
    window_days: number;
    updated_at: string | null;
    note: string;
  };
  confidence?: { level: string; note: string } | null;
  composition?: CompositionItem[];
  component_note?: string;
};

type Incident = {
  id: number;
  title: string;
  status: string;
  severity: string;
  owner?: string;
};

type SummaryData = {
  error?: string;
  greeting?: string;
  view?: { density?: string; vocabulary?: string };
  work_evidence?: {
    sources_monitored?: number;
    comments_analyzed?: number;
    detection_minutes?: number | null;
    subjects_tracked?: number;
  };
  reputations?: Reputation[];
  open_incidents?: number;
  incidents?: Incident[];
};

type Channel = { channel: string; destination: string; active: boolean };
type Invoice = { id: number; amount: number | string; status: string };
type PlanData = {
  error?: string;
  plan?: { label?: string; priceBrl?: number | null } | null;
  subscription_status?: string;
  included?: string[];
  avisos?: { channels?: Channel[] };
  invoices?: Invoice[];
};

export default function AppPortal() {
  const [data, setData] = useState<SummaryData | null>(null);
  const [tab, setTab] = useState<'panorama' | 'crises' | 'relatorios' | 'conta'>('panorama');
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [ownerView, setOwnerView] = useState(false);

  // Descobre se e o dono em visao de carteira; se for, lista os clientes.
  useEffect(() => {
    fetch('/api/me/permissions')
      .then((r) => r.json())
      .then((p) => {
        if (p?.permissions?.system === true) {
          setOwnerView(true);
          return fetch('/api/console/tenants')
            .then((r) => r.json())
            .then((d) => {
              const list = d.tenants ?? [];
              setTenants(list);
              if (list.length > 0) setTenantId(list[0].id);
            });
        }
      })
      .catch(() => {});
  }, []);

  // O tenant escolhido vai como parametro apenas para o dono. Um cliente
  // logado NUNCA envia tenant_id: o servidor resolve pela sessao.
  useEffect(() => {
    const qs = ownerView && tenantId ? `?tenant_id=${tenantId}` : '';
    if (ownerView && !tenantId) return;
    fetch(`/api/app/summary${qs}`).then((r) => r.json()).then(setData).catch(() => {});
  }, [ownerView, tenantId]);

  if (!data) return <div className="p-8 text-center text-gray-500">Carregando...</div>;
  if (data.error) {
    return <div className="p-8 text-center text-gray-500">{data.error}</div>;
  }

  const isLeigo = data.view?.vocabulary === 'leigo';
  const isBasico = data.view?.density === 'basico';
  const openIncidents = data.open_incidents ?? 0;
  const clienteAtual = tenants.find((t) => t.id === tenantId);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">VigiaPlus</h1>
          <p className="text-sm text-gray-500">
            {ownerView && clienteAtual ? `Visualizando: ${clienteAtual.name}` : data.greeting}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {ownerView && tenants.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <span className="text-xs uppercase tracking-wide text-gray-400">Cliente</span>
              <select
                value={tenantId ?? ''}
                onChange={(e) => { setTenantId(Number(e.target.value)); setData(null); }}
                className="rounded-lg border px-2 py-1.5 text-sm bg-white"
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.plan})</option>
                ))}
              </select>
            </label>
          )}

          {(['panorama', 'crises', 'relatorios', 'conta'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t === 'panorama' ? 'Panorama' : t === 'crises' ? 'Crises' : t === 'relatorios' ? 'Relatorios' : 'Minha conta'}
            </button>
          ))}
          <ViewModeToggle compact />
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6">
        {tab === 'panorama' && (
          <div className="space-y-6">
            {/* Evidencia de trabalho: "as vezes o pouco e muito" */}
            <div className="bg-white rounded-xl border p-4">
              <div className="flex gap-6 text-sm text-gray-500 flex-wrap">
                <span>{data.work_evidence?.sources_monitored ?? 0} fontes com menções no período</span>
                {!isBasico && (
                  <>
                    <span>{data.work_evidence?.comments_analyzed ?? 0} menções analisadas</span>
                    <span>{data.work_evidence?.detection_minutes == null
                      ? 'Tempo de detecção não aferido'
                      : `Detecção em ${data.work_evidence.detection_minutes} min`}</span>
                  </>
                )}
                <span>{data.work_evidence?.subjects_tracked ?? 0} assuntos acompanhados</span>
              </div>
            </div>

            {/* Duas reputacoes — contrato do numero unico (remodelagem.md §5) */}
            <div className="grid grid-cols-2 gap-4">
              {data.reputations?.map((r: Reputation) => (
                <ReputationCard key={r.id} r={r} isLeigo={isLeigo} isBasico={isBasico} />
              ))}
            </div>

            {/* Tem crise? */}
            <div className={`rounded-xl border p-6 ${openIncidents > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              <p className="text-lg font-semibold">
                {openIncidents > 0
                  ? `${openIncidents} incidente(s) em acompanhamento`
                  : 'Nenhum incidente ativo registrado'}
              </p>
              {data.incidents?.map((i: Incident) => (
                <div key={i.id} className="mt-3 text-sm">
                  <span className="font-medium">{i.title}</span>
                  <span className="text-gray-500 ml-2">- {i.status} - {i.severity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'crises' && (
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-semibold mb-4">Gestao de crises</h2>
            {openIncidents === 0 ? (
              <p className="text-gray-500">Nenhum incidente ativo no momento.</p>
            ) : (
              <div className="space-y-3">
                {data.incidents?.map((i: Incident) => (
                  <div key={i.id} className="border rounded-lg p-4">
                    <p className="font-medium">{i.title}</p>
                    <div className="flex gap-4 text-sm text-gray-500 mt-1">
                      <span>Status: {i.status}</span>
                      <span>Severidade: {i.severity}</span>
                      <span>Responsavel: {i.owner}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'relatorios' && (
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-semibold mb-4">Relatorios</h2>
            <p className="text-gray-500">Relatorios periodicos e personalizados aparecem aqui.</p>
          </div>
        )}

        {tab === 'conta' && <ContaTab ownerView={ownerView} tenantId={tenantId} />}
      </main>
    </div>
  );
}

const fmtBR = (n: number) => new Intl.NumberFormat('pt-BR').format(n);

/**
 * Cartao de reputacao. O numero NUNCA some e NUNCA e trocado por adjetivo:
 * o que muda entre leigo/tecnico sao as PALAVRAS; os dados sao identicos.
 * O modo avancado revela composicao e procedencia NA MESMA TELA (ADR-03).
 */
function ReputationCard({ r, isLeigo, isBasico }: { r: Reputation; isLeigo: boolean; isBasico: boolean }) {
  const title = r.kind === 'brand' ? 'Sua marca' : r.kind === 'market' ? 'Seu mercado' : 'Entidade';
  const hasScore = r.score != null;
  const delta = r.comparison?.delta ?? null;
  const reference = r.comparison?.reference ?? 'referência';
  const prov = r.provenance;

  const headline = isLeigo
    ? r.headline
    : hasScore
      ? `Brand Health ${r.score}/100` +
        (delta != null ? ` · Δ ${reference} ${delta > 0 ? '+' : ''}${delta}` : '') +
        ` · n=${fmtBR(prov.comments)} · janela ${prov.window_days}d`
      : 'Pontuação indisponível: sem metodologia validada para este alvo.';

  const provenanceLine = isLeigo
    ? prov.note
    : `n=${fmtBR(prov.comments)} · ${prov.sources} fontes · ${prov.window_days} dias · última coleta: ${prov.updated_at ? new Date(prov.updated_at).toLocaleString('pt-BR') : 'indisponível'}`;

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-gray-500 mb-1">{title}</p>
          <p className="text-lg font-semibold text-gray-900">{r.name}</p>
        </div>
        {r.confidence && (
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${
            r.confidence.level === 'consolidado' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {r.confidence.level === 'consolidado' ? 'Base consolidada' : r.confidence.level === 'sem_dados' ? 'Sem dados' : 'Resultado preliminar'}
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-2 mt-3 flex-wrap">
        <span className="text-4xl font-bold text-gray-900">{hasScore ? r.score : '—'}</span>
        <span className="text-sm text-gray-400">de 100</span>
        {delta != null && (
          <span className={`ml-1 rounded-md px-2 py-0.5 text-xs font-medium ${
            delta >= 0 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
          }`}>
            {delta > 0 ? '+' : ''}{delta} vs {reference}
          </span>
        )}
      </div>

      <p className="mt-3 text-sm text-gray-700 leading-relaxed">{headline}</p>
      <p className="mt-2 text-xs text-gray-500">{provenanceLine}</p>
      <p className="mt-2 text-xs text-gray-400">{r.confidence?.note}</p>

      {!isBasico && (
        <div className="mt-4 border-t pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
            {isLeigo ? 'Como chegamos a esse número' : 'Score composition'}
          </p>
          <div className="space-y-1">
            {r.composition?.map((c: CompositionItem) => (
              <div key={c.key} className="flex justify-between text-xs text-gray-600">
                <span>{isLeigo ? c.label : c.technical}</span>
                <span className="tabular-nums">{c.weight}%</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">{r.component_note}</p>
          <p className="text-xs text-gray-500 mt-2">{r.comparison?.temporal_note}</p>
        </div>
      )}
    </div>
  );
}

function ContaTab({ ownerView, tenantId }: { ownerView: boolean; tenantId: number | null }) {
  const [plan, setPlan] = useState<PlanData | null>(null);
  useEffect(() => {
    const qs = ownerView && tenantId ? `?tenant_id=${tenantId}` : '';
    if (ownerView && !tenantId) return;
    fetch(`/api/app/plan${qs}`).then((r) => r.json()).then(setPlan).catch(() => {});
  }, [ownerView, tenantId]);
  if (!plan) return <div className="text-gray-500">Carregando...</div>;
  if (plan.error) return <div className="text-gray-500">{plan.error}</div>;

  return (
    <div className="space-y-6">
      {/* Preferencias de visualizacao (ADR-03) */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold mb-4">Modo de visualizacao</h2>
        <p className="text-sm text-gray-500 mb-3">
          Estas preferencias mudam como a informacao aparece, mas nao alteram o que voce pode acessar.
        </p>
        <ViewModeToggle />
      </div>

      {/* Meu plano */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold mb-4">Meu plano</h2>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-2xl font-bold">{plan.plan?.label ?? 'Sem plano'}</span>
          {plan.plan?.priceBrl != null && (
            <span className="text-gray-500">R$ {plan.plan?.priceBrl}/mes</span>
          )}
          <span className="text-xs text-gray-400">{plan.subscription_status}</span>
        </div>
        <p className="text-sm text-gray-500 mb-2">Inclusos:</p>
        <div className="flex flex-wrap gap-2">
          {plan.included?.map((f: string) => (
            <span key={f} className="px-3 py-1 bg-green-50 text-green-700 rounded-full text-xs">{f}</span>
          ))}
        </div>
      </div>

      {/* Avisos */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold mb-4">Avisos</h2>
        <p className="text-sm text-gray-500 mb-3">Canais de notificacao:</p>
        <div className="space-y-2">
          {plan.avisos?.channels?.map((c: Channel, i: number) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span>{c.channel}: {c.destination}</span>
              <span className={c.active ? 'text-green-600' : 'text-gray-400'}>
                {c.active ? 'ativo' : 'inativo'}
              </span>
            </div>
          ))}
          {(!plan.avisos?.channels || plan.avisos.channels.length === 0) && (
            <p className="text-sm text-gray-400">Nenhum canal configurado.</p>
          )}
        </div>
      </div>

      {/* Faturas */}
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold mb-4">Faturas</h2>
        <div className="space-y-2">
          {plan.invoices?.map((inv: Invoice) => (
            <div key={inv.id} className="flex justify-between text-sm">
              <span>R$ {inv.amount}</span>
              <span className={inv.status === 'paid' ? 'text-green-600' : 'text-amber-600'}>{inv.status}</span>
            </div>
          ))}
          {(!plan.invoices || plan.invoices.length === 0) && (
            <p className="text-sm text-gray-400">Nenhuma fatura emitida.</p>
          )}
        </div>
      </div>
    </div>
  );
}
