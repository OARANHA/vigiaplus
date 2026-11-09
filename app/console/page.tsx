'use client';
import { useState, useEffect } from 'react';
import { ViewModeToggle } from '@/components/view-mode-toggle';

type TenantRow = {
  id: number;
  name: string;
  plan: string;
  status: string;
  domain?: string | null;
};

type ProviderRow = {
  id: string | number;
  name: string;
  model: string;
  baseUrl: string;
  scope: string;
};

type BillingSummary = { resumo?: { mrr?: number; faturasEmAberto?: number; custoIa?: number } };

type LlmStatus = {
  available: boolean;
  active?: { name: string; source: string } | null;
};

// Console do dono: 18 areas. Esta e a visao geral + navegacao.
export default function ConsoleHome() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);

  useEffect(() => {
    fetch('/api/console/tenants').then(r => r.json()).then(d => setTenants(d.tenants ?? [])).catch(() => {});
    fetch('/api/console/llm-providers').then(r => r.json()).then(d => setProviders(d.providers ?? [])).catch(() => {});
    fetch('/api/console/llm-status').then(r => r.json()).then(setLlmStatus).catch(() => {});
    fetch('/api/console/billing').then(r => r.json()).then(setBilling).catch(() => {});
  }, []);

  const areas: { label: string; href?: string }[] = [
    { label: 'Visão geral', href: '#visao-geral' },
    { label: 'Clientes', href: '#clientes' },
    { label: 'Planos e faturamento', href: '#visao-geral' },
    { label: 'Fontes e credenciais', href: '/impostazioni/fonti' },
    { label: 'Coleta e fila', href: '/vigia' },
    { label: 'Motor de IA', href: '#motor-ia' },
    { label: 'Regras de crise', href: '/alerts' },
    { label: 'Acessos e segurança', href: '/impostazioni/team' },
    { label: 'LGPD' }, { label: 'Marca' },
    { label: 'Relatórios', href: '/report' },
    { label: 'Sistema e flags', href: '/settings' },
    { label: 'Modo analista', href: '/dashboard' },
    { label: 'Auditoria' }, { label: 'Incidentes', href: '/insights/crisis' },
    { label: 'Notificações', href: '/alerts' }, { label: 'MCP', href: '/mcp' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Console do dono - VigiaPlus</h1>
          <p className="text-sm text-gray-500">Operacao, isolamento, custo, SLA, conformidade e faturamento</p>
        </div>
        <ViewModeToggle compact />
      </header>

      <div className="max-w-7xl mx-auto p-6 grid grid-cols-12 gap-6">
        {/* Sidebar com 18 areas */}
        <nav className="col-span-3 bg-white rounded-xl border p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase mb-3">Areas</p>
          <div className="space-y-1">
            {areas.map((a) => a.href ? (
              <a href={a.href} key={a.label} className="block w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
                {a.label}
              </a>
            ) : (
              <span key={a.label} className="block w-full px-3 py-2 text-sm text-gray-400" title="Em preparação">
                {a.label} · em preparação
              </span>
            ))}
          </div>
        </nav>

        {/* Conteudo */}
        <div className="col-span-9 space-y-6">
          {/* Visao geral */}
          <div id="visao-geral" className="grid grid-cols-4 gap-4">
            <Card label="Clientes ativos cadastrados" value={tenants.filter(t => t.status === 'active').length} />
            <Card label="Provedores LLM cadastrados" value={providers.length} />
            <Card label="MRR contratual (não recebido)" value={billing?.resumo?.mrr == null ? '—' : billing.resumo.mrr.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} />
            <Card label="Faturas em aberto" value={billing?.resumo?.faturasEmAberto ?? '—'} />
          </div>

          {/* Clientes */}
          <div id="clientes" className="bg-white rounded-xl border p-6">
            <h2 className="text-lg font-semibold mb-4">Clientes</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Nome</th>
                  <th>Plano</th>
                  <th>Status</th>
                  <th>Dominio</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-b">
                    <td className="py-2 font-medium">{t.name}</td>
                    <td>{t.plan}</td>
                    <td>{t.status}</td>
                    <td>{t.domain ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* LLM Providers */}
          <div id="motor-ia" className="bg-white rounded-xl border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Motor de IA - Provedores</h2>
              {llmStatus && (
                <div className="flex items-center gap-3 text-sm">
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    llmStatus.available ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {llmStatus.available ? 'IA disponivel' : 'IA indisponivel'}
                  </span>
                  {llmStatus.active && (
                    <span className="text-gray-500 text-xs">
                      Ativo: {llmStatus.active.name} ({llmStatus.active.source})
                    </span>
                  )}
                </div>
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2">Nome</th>
                  <th>Modelo</th>
                  <th>Base URL</th>
                  <th>Escopo</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="border-b">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td>{p.model}</td>
                    <td className="text-gray-500 text-xs">{p.baseUrl}</td>
                    <td>{p.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
