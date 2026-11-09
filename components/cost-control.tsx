'use client';

import { useActionState } from 'react';
import { RotateCcw, Save, Lock } from 'lucide-react';
import { updateApiBudget, resetApiSpend, type ActionResult } from '@/app/settings/actions';

const INIT: ActionResult = { ok: false, msg: '' };

export function CostControl({ budget, lifetimeCost, lifetimeCalls, resetAt }: {
  budget: number; lifetimeCost: number; lifetimeCalls: number; resetAt: string;
}) {
  const [budgetState, budgetAction, budgetPending] = useActionState(updateApiBudget, INIT);
  const [resetState, resetAction, resetPending] = useActionState(resetApiSpend, INIT);

  return (
    <div className="mt-4 flex flex-col gap-4 border-t border-[var(--border)] pt-4">
      {/* Budget */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Limite de gastos</h3>
        <form action={budgetAction} className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400">$</span>
          <input name="budget" type="number" step="0.5" min="0.5" defaultValue={budget}
            className="w-28 rounded-lg border border-[var(--border)] bg-white/5 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500" />
          <button type="submit" disabled={budgetPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50">
            <Save className="size-3.5" />{budgetPending ? 'Salvando…' : 'Salvar orçamento'}
          </button>
          {budgetState.msg && <span className={`text-xs ${budgetState.ok ? 'text-emerald-400' : 'text-red-400'}`}>{budgetState.msg}</span>}
        </form>
        <p className="mt-1 text-[11px] text-slate-600">Quando o consumo alcançar o limite, o VigiaPlus interromperá as chamadas de IA. A coleta de dados continua.</p>
      </div>

      {/* Reset */}
      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Reiniciar contador de gastos</h3>
        <form action={resetAction} className="flex flex-wrap items-center gap-2">
          <span className="relative inline-flex items-center">
            <Lock className="pointer-events-none absolute left-2.5 size-3.5 text-slate-500" />
            <input name="password" type="password" placeholder="Senha da sua conta" required
              className="w-56 rounded-lg border border-[var(--border)] bg-white/5 py-1.5 pl-8 pr-3 text-sm text-slate-100 outline-none focus:border-sky-500" />
          </span>
          <button type="submit" disabled={resetPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-300 hover:bg-amber-500/20 disabled:opacity-50">
            <RotateCcw className="size-3.5" />{resetPending ? 'Reiniciando…' : 'Zerar contador'}
          </button>
          {resetState.msg && <span className={`text-xs ${resetState.ok ? 'text-emerald-400' : 'text-red-400'}`}>{resetState.msg}</span>}
        </form>
        <p className="mt-1 text-[11px] text-slate-600">
          Zera o contador e inicia um novo período. Exige a senha de administrador. Última reinicialização:{' '}
          <span className="text-slate-500">{new Date(resetAt).toLocaleString('pt-BR')}</span>.
        </p>
      </div>

      {/* Totale storico */}
      <div className="rounded-lg border border-[var(--border)] bg-white/[0.02] px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Consumo acumulado · todos os usuários</p>
        <p className="mt-1 text-2xl font-bold text-slate-100">${lifetimeCost.toFixed(2)}</p>
        <p className="text-xs text-slate-500">{lifetimeCalls.toLocaleString('pt-BR')} chamadas de IA no total; esse histórico não é afetado por reinicializações.</p>
      </div>
    </div>
  );
}
