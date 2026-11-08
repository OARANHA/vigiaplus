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

type LlmStatus = {
  available: boolean;
  active?: { name: string; source: string } | null;
};

// Console do dono: 18 areas. Esta e a visao geral + navegacao.
export default function ConsoleHome() {
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [llmStatus, setLlmStatus] = useState<LlmStatus | null>(null);

  useEffect(() => {
    fetch('/api/console/tenants').then(r => r.json()).then(d => setTenants(d.tenants ?? [])).catch(() => {});
    fetch('/api/console/llm-providers').then(r => r.json()).then(d => setProviders(d.providers ?? [])).catch(() => {});
    fetch('/api/console/llm-status').then(r => r.json()).then(setLlmStatus).catch(() => {});
  }, []);

  const areas = [
    'Visao geral', 'Clientes', 'Planos e faturamento', 'Fontes e credenciais',
    'Coleta e fila', 'Motor de IA', 'Regras de crise', 'Acessos e seguranca',
    'LGPD', 'Marca', 'Relatorios', 'Sistema e flags', 'Modo analista',
    'Auditoria', 'Incidentes', 'Faturamento', 'Notificacoes', 'MCP',
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
            {areas.map((a) => (
              <button key={a} className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100">
                {a}
              </button>
            ))}
          </div>
        </nav>

        {/* Conteudo */}
        <div className="col-span-9 space-y-6">
          {/* Visao geral */}
          <div className="grid grid-cols-4 gap-4">
            <Card label="Clientes ativos" value={tenants.filter(t => t.status === 'active').length} />
            <Card label="Provedores LLM" value={providers.length} />
            <Card label="MRR (estimado)" value="R$ 2.380" />
            <Card label="SLA de deteccao" value="11 min" />
          </div>

          {/* Clientes */}
          <div className="bg-white rounded-xl border p-6">
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
          <div className="bg-white rounded-xl border p-6">
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
