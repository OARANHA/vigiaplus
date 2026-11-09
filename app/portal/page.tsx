'use client';

import { useEffect, useState } from 'react';
import './portal-extra.css';
import Link from 'next/link';
import {
  Activity, ArrowRight, Bell, BookOpen, CalendarClock, ChevronRight, CreditCard,
  ExternalLink, FileText, LayoutDashboard, LogOut, Radio, RefreshCw, ShieldCheck,
  Siren, UsersRound,
} from 'lucide-react';
import { ViewModeToggle } from '@/components/view-mode-toggle';

type Tenant = { id: number; name: string; plan?: string };
type Reputation = {
  id: number; kind: string; name: string; score: number | null;
  headline: string;
  provenance?: { comments: number; sources: number; window_days: number; updated_at: string | null; note: string };
  confidence?: { level: string; note: string } | null;
};
type Incident = { id: number; title: string; status: string; severity: string; owner?: string };
type Summary = {
  greeting?: string; error?: string;
  work_evidence?: {
    sources_monitored?: number; comments_analyzed?: number; subjects_tracked?: number;
    detection_minutes?: number | null; updated_at?: string | null;
  };
  reputations?: Reputation[]; incidents?: Incident[]; open_incidents?: number;
};
type Evidence = {
  id: number; title: string | null; url: string | null; source: string;
  projectName: string; publishedAt: string | null;
};
type Plan = {
  error?: string; plan?: { label?: string; priceBrl?: number | null } | null;
  subscription_status?: string; included?: string[];
  invoices?: { id: number; amount: number; status: string }[];
  avisos?: { channels?: { channel: string; destination: string; active: boolean }[] };
};
type Tab = 'panorama' | 'crises' | 'relatorios' | 'conta';

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || 'Não foi possível consultar os dados.');
  return data as T;
}
function numberOrDash(value: number | undefined): string {
  return typeof value === 'number' ? new Intl.NumberFormat('pt-BR').format(value) : '—';
}
function dateBR(iso: string | null | undefined): string {
  if (!iso) return 'Data indisponível';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Data indisponível'
    : date.toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function statusPT(status: string): string {
  const statuses: Record<string, string> = {
    active: 'Ativo', paid: 'Pago', open: 'Em aberto', trial: 'Em avaliação',
    monitoring: 'Em acompanhamento', resolved: 'Resolvido', closed: 'Encerrado',
    past_due: 'Em atraso', canceled: 'Cancelado', none: 'Sem assinatura',
  };
  return statuses[status] ?? status;
}

const TABS: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'panorama', label: 'Panorama', icon: LayoutDashboard },
  { id: 'crises', label: 'Crises', icon: Siren },
  { id: 'relatorios', label: 'Publicações e relatórios', icon: FileText },
  { id: 'conta', label: 'Meu plano', icon: CreditCard },
];

export default function ClientPortal() {
  const [tab, setTab] = useState<Tab>('panorama');
  const [owner, setOwner] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [evidence, setEvidence] = useState<Evidence[] | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const permissions = await getJson<{ permissions?: { system?: boolean } }>('/api/me/permissions');
        if (!mounted) return;
        if (permissions.permissions?.system) {
          const result = await getJson<{ tenants: Tenant[] }>('/api/console/tenants');
          if (!mounted) return;
          setOwner(true);
          setTenants(result.tenants ?? []);
          setTenantId(result.tenants?.[0]?.id ?? null);
        }
        setInitialized(true);
      } catch (err) {
        if (mounted) { setError(err instanceof Error ? err.message : 'Falha ao verificar o acesso'); setInitialized(true); }
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!initialized || (owner && !tenantId)) { setLoading(false); return; }
    let mounted = true;
    setLoading(true); setError(''); setPlan(null);
    const query = owner && tenantId ? '?tenant_id=' + tenantId : '';
    Promise.all([getJson<Summary>('/api/app/summary' + query),
      getJson<{ items: Evidence[] }>('/api/app/evidence' + query)])
      .then(([s, e]) => {
        if (mounted) { setSummary(s); setEvidence(e.items); }
      })
      .catch((err) => {
        if (mounted) { setSummary(null); setEvidence(null); setError(err instanceof Error ? err.message : 'Falha de consulta'); }
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [initialized, owner, tenantId]);

  useEffect(() => {
    if (tab !== 'conta' || !initialized || (owner && !tenantId)) return;
    let active = true;
    const query = owner && tenantId ? '?tenant_id=' + tenantId : '';
    getJson<Plan>('/api/app/plan' + query)
      .then((result) => { if (active) setPlan(result); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Falha de consulta'); });
    return () => { active = false; };
  }, [tab, initialized, owner, tenantId]);

  async function logout() {
    await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logout: true }) }).catch(() => {});
    window.location.replace('/login');
  }

  const selected = tenants.find((t) => t.id === tenantId);
  const metrics = [
    { name: 'Fontes observadas', value: numberOrDash(summary?.work_evidence?.sources_monitored), icon: Radio, className: 'cp-metric-violet' },
    { name: 'Menções analisadas', value: numberOrDash(summary?.work_evidence?.comments_analyzed), icon: Activity, className: 'cp-metric-cyan' },
    { name: 'Assuntos monitorados', value: numberOrDash(summary?.work_evidence?.subjects_tracked), icon: ShieldCheck, className: 'cp-metric-mint' },
    { name: 'Incidentes abertos', value: numberOrDash(summary?.open_incidents), icon: Siren, className: 'cp-metric-rose' },
  ];
  const reputations = summary?.reputations ?? [];
  const incidents = summary?.incidents ?? [];

  return (
    <div className="cp-shell">
      <aside className="cp-nav" aria-label="Navegação do cliente">
        <Link href="/portal" className="cp-logo"><Radio size={27}/> VigiaPlus <small>CLIENTE</small></Link>
        <p className="cp-section-kicker">INTELIGÊNCIA</p>
        <nav aria-label="Seções da área do cliente">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => { setTab(id); setError(''); }}
              aria-current={tab === id ? 'page' : undefined}
              className={'cp-portal-tab ' + (tab === id ? 'active' : '')}>
              <Icon size={17}/><span>{label}</span>
            </button>
          ))}
        </nav>
        {owner && <Link href="/console" className="cp-console-link"><ShieldCheck size={16}/> Voltar ao console</Link>}
        <div className="cp-nav-bottom">
          <span className="cp-avatar"><UsersRound size={17}/></span>
          <span className="cp-user-name">{owner ? 'Visualização do proprietário' : 'Área exclusiva do cliente'}</span>
          <button type="button" onClick={logout} aria-label="Sair"><LogOut size={17}/></button>
        </div>
      </aside>

      <div className="cp-main">
        <header className="cp-topbar">
          <span><span className="cp-state"><i/></span> Monitoramento e inteligência</span>
          <div>
            <Link className="cp-toplink" href="/impostazioni/account">Minha conta</Link>
            <button type="button" onClick={logout}><LogOut size={14}/> Sair</button>
          </div>
        </header>
        <main className="cp-content cp-dashboard">
          <div className="cp-heading">
            <div>
              <p className="cp-eyebrow"><ShieldCheck size={16}/> PORTAL DE INTELIGÊNCIA</p>
              <h1>{owner && selected ? selected.name : 'Sua reputação, com contexto.'}</h1>
              <p>{owner ? 'Visualização do portal do cliente, com acesso restrito ao proprietário.'
                : 'Acompanhe publicações, sinais de risco, fontes e informações da sua organização.'}</p>
            </div>
            {owner && (
              <label className="cp-project-picker">
                <span>Visualizar como cliente</span>
                <select className="cp-select" value={tenantId ?? ''} onChange={(e) => setTenantId(Number(e.target.value))}>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {error && <div className="cp-alert" role="alert">{error}</div>}
          {loading ? <div className="cp-panel" role="status">Carregando informações autorizadas…</div>
            : owner && !tenantId ? <div className="cp-empty">
                <h2>Nenhum cliente cadastrado</h2><p>Cadastre e vincule um cliente no console do proprietário.</p>
              </div>
            : !summary ? <div className="cp-empty">
                <h2>Dados indisponíveis</h2><p>Verifique a conexão e os vínculos de acesso deste cliente.</p>
              </div> : (
                <>
                  <div className="cp-metrics" aria-label="Indicadores observados">
                    {metrics.map(({ name, value, icon: Icon, className }) => (
                      <div key={name} className={'cp-metric ' + className}>
                        <Icon size={19}/><span>{name}</span><strong>{value}</strong>
                        <small>Dados do período informado pelas fontes</small>
                      </div>
                    ))}
                  </div>

                  {tab === 'panorama' && <>
                    <div className="cp-panels">
                      <section className="cp-panel">
                        <div className="cp-panel-title"><div><BookOpen size={19}/><h2>Menções e publicações recentes</h2></div>
                          <button type="button" onClick={() => setTab('relatorios')} className="cp-small-link">
                            Todas as evidências <ChevronRight size={14}/></button>
                        </div>
                        <EvidenceList data={evidence}/>
                      </section>
                      <section className="cp-panel">
                        <div className="cp-panel-title"><div><ShieldCheck size={19}/><h2>Visão de reputação</h2></div></div>
                        {reputations.length ? reputations.map((r) => <ReputationPanel key={r.id} reputation={r}/>) :
                          <p className="cp-placeholder">Nenhum indicador de reputação calculado. Cadastre alvos e aguarde dados verificáveis.</p>}
                      </section>
                    </div>
                    <section className="cp-panel">
                      <div className="cp-panel-title"><div><Siren size={19}/><h2>Situação de crises</h2></div>
                        <button type="button" className="cp-small-link" onClick={() => setTab('crises')}>Ver ocorrências <ArrowRight size={14}/></button>
                      </div>
                      {incidents.length ? <IncidentList data={incidents}/> :
                        <p className="cp-placeholder">Nenhum incidente ativo registrado neste período.</p>}
                    </section>
                    <div className="cp-footer-note"><CalendarClock size={15}/>
                      Última coleta conhecida: {dateBR(summary.work_evidence?.updated_at)}. Indicadores sem medição não recebem valores estimados.
                    </div>
                  </>}

                  {tab === 'crises' && <section className="cp-panel">
                    <div className="cp-panel-title"><div><Siren size={19}/><h2>Gestão de crises</h2></div>
                      <span className="cp-pill">{incidents.length} ocorrências no retorno da API</span></div>
                    {incidents.length ? <IncidentList data={incidents}/> :
                      <p className="cp-placeholder">Nenhuma ocorrência registrada para este cliente.</p>}
                  </section>}

                  {tab === 'relatorios' && <section className="cp-panel">
                    <div className="cp-panel-title"><div><FileText size={19}/><h2>Publicações e evidências</h2></div></div>
                    <p className="cp-note">Links e datas originais, filtrados pelos projetos do seu cliente. Relatórios adicionais dependem de processamento e autorização.</p>
                    <EvidenceList data={evidence}/>
                  </section>}

                  {tab === 'conta' && <section className="cp-panel">
                    <div className="cp-panel-title"><div><CreditCard size={19}/><h2>Meu plano e notificações</h2></div></div>
                    {!plan ? <p className="cp-placeholder">Consultando informações do plano…</p> : (
                      <div className="cp-plan-grid">
                        <div><h3>Plano contratado</h3><strong>{plan.plan?.label ?? 'Não informado'}</strong>
                          <p>Situação: {statusPT(plan.subscription_status ?? 'none')}</p>
                          <p>Mensalidade: {plan.plan?.priceBrl == null ? 'Não informada'
                            : plan.plan.priceBrl.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                          <div className="cp-tags">{(plan.included ?? []).map((feature) =>
                            <span key={feature}>{feature.replaceAll('_',' ')}</span>)}</div>
                        </div>
                        <div><h3>Faturas</h3>
                          {plan.invoices?.length ? plan.invoices.map((inv) =>
                            <p key={inv.id}>{Number(inv.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · {statusPT(inv.status)}</p>)
                            : <p>Nenhuma fatura emitida.</p>}
                          <h3 className="mt-5">Avisos</h3>
                          {plan.avisos?.channels?.length ? plan.avisos.channels.map((c) =>
                            <p key={c.channel + c.destination}>{c.channel}: {c.active ? 'ativo' : 'inativo'}</p>)
                            : <p>Nenhum canal configurado.</p>}
                        </div>
                      </div>
                    )}
                    <div className="mt-5"><ViewModeToggle/></div>
                  </section>}
                </>
              )}
        </main>
      </div>
    </div>
  );
}

function EvidenceList({ data }: { data: Evidence[] | null }) {
  if (!data?.length) return <p className="cp-placeholder">Nenhuma publicação coletada para este cliente. As evidências aparecerão após a coleta autorizada.</p>;
  return <div className="cp-articles">{data.map((m) => <article key={m.id}>
    <div><h3>{m.title || 'Publicação sem título'}</h3>
      <p>{m.source} · {m.projectName} · {dateBR(m.publishedAt)}</p></div>
    {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" aria-label={'Abrir publicação ' + (m.title || '')}>
      <ExternalLink size={16}/></a>}
  </article>)}</div>;
}
function ReputationPanel({ reputation: r }: { reputation: Reputation }) {
  return <div className="cp-reputation">
    <div className="flex items-center justify-between gap-3"><h3>{r.name}</h3>
      <span className="cp-pill">{r.confidence?.level === 'consolidado' ? 'Consolidado' :
        r.confidence?.level === 'preliminar' ? 'Preliminar' : 'Sem pontuação certificada'}</span>
    </div>
    <div className="cp-reputation-score">{r.score ?? '—'} <small>/ 100</small></div>
    <p>{r.headline}</p>
    <p className="cp-note">{r.provenance?.note ?? 'Sem histórico suficiente para calcular evolução.'}</p>
  </div>;
}
function IncidentList({ data }: { data: Incident[] }) {
  return <div className="cp-incident-list">{data.map((i) =>
    <article key={i.id}><div><strong>{i.title}</strong>
      <p>{statusPT(i.status)} · Prioridade: {i.severity}</p></div>
      <span className="cp-pill">{i.owner || 'Sem responsável definido'}</span>
    </article>)}</div>;
}
