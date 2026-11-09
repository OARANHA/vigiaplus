'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, BrainCircuit, CreditCard, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { ViewModeToggle } from '@/components/view-mode-toggle';
import { CONSOLE_GROUPS } from '@/lib/admin-navigation';

type Tenant = {
  id: number; name: string; plan: string; status: string; domain: string | null;
};
type Provider = {
  id: string | number; name: string; model: string; baseUrl: string;
  scope: string; enabled?: boolean;
};
type Billing = {
  resumo?: { mrr?: number; faturasEmAberto?: number; custoIa?: number; clientesAtivos?: number };
  gateways?: {
    stripe?: { configured?: boolean; webhook?: boolean };
    pix?: { configured?: boolean; webhook?: boolean };
  };
};
type AiStatus = { available: boolean; active?: { name: string; source: string; model?: string } | null };

async function apiJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json() as Promise<T>;
}
function real(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n)
    ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';
}
function situacao(status: string): string {
  const known: Record<string, string> = {
    active: 'Ativo', inactive: 'Inativo', suspended: 'Suspenso', trial: 'Em avaliação',
    past_due: 'Em atraso', canceled: 'Cancelado', paused: 'Pausado', none: 'Sem assinatura',
  };
  return known[status] ?? status;
}
function Kpi({ label, value, note, icon: Icon }: {
  label: string; value: string | number; note: string; icon: typeof Users;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium leading-5 text-slate-400">{label}</p>
        <Icon className="size-4 shrink-0 text-sky-400" aria-hidden="true" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-50">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
    </div>
  );
}

export function ConsoleOwnerDashboard() {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [tenantResult, providerResult, billingResult, aiResult] = await Promise.allSettled([
      apiJson<{ tenants: Tenant[] }>('/api/console/tenants'),
      apiJson<{ providers: Provider[] }>('/api/console/llm-providers'),
      apiJson<Billing>('/api/console/billing'),
      apiJson<AiStatus>('/api/console/llm-status'),
    ]);
    const failures: string[] = [];
    if (tenantResult.status === 'fulfilled') setTenants(tenantResult.value.tenants ?? []);
    else { setTenants(null); failures.push('clientes'); }
    if (providerResult.status === 'fulfilled') setProviders(providerResult.value.providers ?? []);
    else { setProviders(null); failures.push('provedores de IA'); }
    if (billingResult.status === 'fulfilled') setBilling(billingResult.value);
    else { setBilling(null); failures.push('faturamento'); }
    if (aiResult.status === 'fulfilled') setAi(aiResult.value);
    else { setAi(null); failures.push('disponibilidade de IA'); }
    setErrors(failures);
    setUpdatedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const gateway = (name: 'pix' | 'stripe'): string => {
    const conf = billing?.gateways?.[name];
    if (!conf) return 'Não verificado';
    if (!conf.configured) return 'Não configurado';
    return conf.webhook ? 'Credenciais configuradas' : 'Webhook não configurado';
  };

  return (
    <div className="space-y-7 pb-12 text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--border)] pb-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">Administração · VigiaPlus</p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-3xl">Console do proprietário</h1>
          <p className="max-w-2xl text-sm leading-6 text-slate-400">
            Clientes, operação, inteligência artificial e faturamento em um único lugar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewModeToggle compact />
          <button type="button" onClick={() => { void refresh(); }} disabled={loading}
            className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-sky-500/40 hover:bg-[var(--panel-2)] disabled:opacity-50">
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} aria-hidden="true" />
            {loading ? 'Consultando…' : 'Atualizar dados'}
          </button>
        </div>
      </header>

      {errors.length > 0 && (
        <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
          Não foi possível consultar: {errors.join(', ')}. Os indicadores correspondentes aparecem como indisponíveis, não como zero.
        </div>
      )}
      {updatedAt && (
        <p className="text-xs text-slate-500" aria-live="polite">
          Última consulta: {updatedAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
        </p>
      )}

      <section aria-label="Indicadores operacionais" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Users} label="Clientes ativos cadastrados"
          value={tenants ? tenants.filter((t) => t.status === 'active').length : '—'}
          note="Clientes com cadastro ativo, não assinaturas pagas." />
        <Kpi icon={BrainCircuit} label="Provedores de IA cadastrados"
          value={providers ? providers.length : '—'}
          note="Quantidade no registro, não chamadas concluídas." />
        <Kpi icon={CreditCard} label="Receita mensal contratual"
          value={real(billing?.resumo?.mrr)}
          note="Estimativa contratual; não representa dinheiro recebido." />
        <Kpi icon={ShieldCheck} label="Faturas em aberto"
          value={billing?.resumo?.faturasEmAberto ?? '—'}
          note="Inclui faturas pendentes de processamento." />
      </section>

      <section aria-labelledby="acessos-heading" className="space-y-4">
        <div>
          <h2 id="acessos-heading" className="text-lg font-semibold text-slate-100">Acesso rápido</h2>
          <p className="mt-1 text-sm text-slate-400">Funções organizadas pelo trabalho a realizar, sem uma segunda barra lateral.</p>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          {CONSOLE_GROUPS.map((group) => (
            <div key={group.label} className="min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4">
              <h3 className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.links.map((item) => (
                  <Link href={item.href} key={item.href}
                    className="group flex min-h-14 items-center justify-between gap-2 rounded-xl px-3 py-2 transition hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-200 group-hover:text-sky-200">{item.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-slate-500">{item.description}</span>
                    </span>
                    <ArrowUpRight className="size-4 shrink-0 text-slate-600 group-hover:text-sky-300" aria-hidden="true" />
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="clientes" aria-labelledby="clientes-heading" className="scroll-mt-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="clientes-heading" className="text-lg font-semibold text-slate-100">Clientes</h2>
            <p className="mt-1 text-xs text-slate-400">Situação cadastral e plano associado a cada organização.</p>
          </div>
          <span className="text-xs text-slate-500">{tenants ? tenants.length + ' cadastrados' : 'Consulta indisponível'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[550px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs text-slate-400">
              <tr><th scope="col" className="py-3 pr-4 font-medium">Organização</th>
                <th scope="col" className="py-3 pr-4 font-medium">Plano</th>
                <th scope="col" className="py-3 pr-4 font-medium">Situação</th>
                <th scope="col" className="py-3 font-medium">Domínio</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {tenants?.length ? tenants.map((tenant) => (
                <tr key={tenant.id} className="text-slate-200">
                  <td className="py-3 pr-4 font-medium">{tenant.name}</td>
                  <td className="py-3 pr-4 text-slate-400">{tenant.plan}</td>
                  <td className="py-3 pr-4">{situacao(tenant.status)}</td>
                  <td className="py-3 text-slate-400">{tenant.domain || 'Não informado'}</td>
                </tr>
              )) : <tr><td colSpan={4} className="py-6 text-center text-slate-400">
                {tenants === null ? 'Não foi possível consultar os clientes.' : 'Nenhum cliente cadastrado.'}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section id="financeiro" aria-labelledby="financeiro-heading" className="scroll-mt-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
        <div className="mb-4">
          <h2 id="financeiro-heading" className="text-lg font-semibold text-slate-100">Planos e faturamento</h2>
          <p className="mt-1 text-xs text-slate-400">A configuração de gateways não confirma que pagamentos foram homologados.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-[var(--panel-2)] p-4">
            <p className="text-xs text-slate-400">Receita mensal contratual</p>
            <p className="mt-2 text-lg font-semibold">{real(billing?.resumo?.mrr)}</p>
          </div>
          <div className="rounded-xl bg-[var(--panel-2)] p-4">
            <p className="text-xs text-slate-400">Custo de IA registrado</p>
            <p className="mt-2 text-lg font-semibold">{real(billing?.resumo?.custoIa)}</p>
          </div>
          <div className="rounded-xl bg-[var(--panel-2)] p-4">
            <p className="text-xs text-slate-400">Pix / Asaas</p>
            <p className="mt-2 text-sm font-medium text-slate-200">{gateway('pix')}</p>
          </div>
          <div className="rounded-xl bg-[var(--panel-2)] p-4">
            <p className="text-xs text-slate-400">Stripe</p>
            <p className="mt-2 text-sm font-medium text-slate-200">{gateway('stripe')}</p>
          </div>
        </div>
      </section>

      <section id="ia" aria-labelledby="ia-heading" className="scroll-mt-6 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="ia-heading" className="text-lg font-semibold text-slate-100">Inteligência artificial</h2>
            <p className="mt-1 text-xs text-slate-400">Registro de modelos e disponibilidade da conexão.</p>
          </div>
          <span className={ai?.available
            ? 'rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300'
            : 'rounded-full border border-[var(--border)] bg-[var(--panel-2)] px-3 py-1 text-xs text-slate-400'}>
            {ai === null ? 'Não verificado' : ai.available ? 'Chave de IA disponível' : 'Chave de IA indisponível'}
          </span>
        </div>
        {ai?.active && <p className="mb-4 text-xs text-slate-400">
          Provedor selecionado: <strong className="font-medium text-slate-200">{ai.active.name}</strong>
          {ai.active.model ? ' · ' + ai.active.model : ''}
        </p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs text-slate-400">
              <tr><th scope="col" className="py-3 pr-4 font-medium">Provedor</th>
                <th scope="col" className="py-3 pr-4 font-medium">Modelo</th>
                <th scope="col" className="py-3 pr-4 font-medium">Endereço da API</th>
                <th scope="col" className="py-3 font-medium">Escopo</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {providers?.length ? providers.map((provider) => (
                <tr key={provider.id}>
                  <td className="py-3 pr-4 font-medium text-slate-200">{provider.name}</td>
                  <td className="py-3 pr-4 text-slate-400">{provider.model}</td>
                  <td className="max-w-[220px] truncate py-3 pr-4 text-xs text-slate-500" title={provider.baseUrl}>{provider.baseUrl}</td>
                  <td className="py-3 text-slate-400">{provider.scope === 'tenant' ? 'Cliente' : provider.scope === 'global' ? 'Global' : provider.scope}</td>
                </tr>
              )) : <tr><td colSpan={4} className="py-6 text-center text-slate-400">
                {providers === null ? 'Não foi possível consultar os provedores.' : 'Nenhum provedor cadastrado.'}
              </td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
