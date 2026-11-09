'use client';

import { useActionState } from 'react';
import { KeyRound, Trash2, UserPlus, Loader2, ShieldCheck } from 'lucide-react';
import { CopyButton } from './copy-button';
import { addUser, resetPassword, toggleAi, deleteUser, type TeamActionState } from '@/app/team/actions';

type Row = {
  id: number; name: string; email: string; role: string;
  aiEnabled: number; mustChangePassword: number; projectCount: number;
};

const input = 'rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-sm outline-none placeholder:text-slate-600';

export function TeamManager({ users }: { users: Row[] }) {
  const [addState, addAction, adding] = useActionState<TeamActionState, FormData>(addUser, {});
  const [resetState, resetAction] = useActionState<TeamActionState, FormData>(resetPassword, {});

  const generated = addState.tempPassword ? addState : resetState.tempPassword ? resetState : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Temporary password just generated (shown only once) */}
      {generated?.tempPassword && (
        <div className="panel border-emerald-500/40 px-5 py-4">
          <p className="text-sm font-semibold text-emerald-300">Senha temporária gerada</p>
          <p className="mt-1 text-xs text-slate-400">
            Para <span className="text-slate-200">{generated.email}</span> — compartilhe com segurança. O sistema não envia e-mail; a senha será alterada no primeiro acesso.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded-lg bg-black/30 px-3 py-1.5 text-sm text-emerald-200">{generated.tempPassword}</code>
            <CopyButton text={generated.tempPassword} />
          </div>
        </div>
      )}

      {/* User list */}
      <section className="panel overflow-x-auto px-5 py-4">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="pb-2">Usuário</th>
              <th className="pb-2">Perfil</th>
              <th className="pb-2 text-center">Projetos</th>
              <th className="pb-2 text-center">AI</th>
              <th className="pb-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-[var(--border)]/50 last:border-0">
                <td className="py-3">
                  <p className="font-medium">{u.name}</p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </td>
                <td className="py-3">
                  {u.role === 'admin'
                    ? <span className="flex items-center gap-1 text-xs text-sky-300"><ShieldCheck className="size-3.5" /> Administrador</span>
                    : <span className="text-xs text-slate-400">Membro</span>}
                </td>
                <td className="py-3 text-center text-slate-400">{u.projectCount}</td>
                <td className="py-3 text-center">
                  {u.role === 'admin' ? (
                    <span className="text-xs text-emerald-400">sempre ativa</span>
                  ) : (
                    <form action={toggleAi} className="inline">
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="enable" value={u.aiEnabled ? '0' : '1'} />
                      <button type="submit"
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                          u.aiEnabled
                            ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                            : 'bg-slate-500/15 text-slate-400 hover:bg-slate-500/25'
                        }`}
                        title={u.aiEnabled ? 'Suspender IA (interrompe custos de chamadas)' : 'Habilitar IA (requer orçamento)'}>
                        {u.aiEnabled ? 'ativada' : 'suspensa'}
                      </button>
                    </form>
                  )}
                </td>
                <td className="py-3">
                  <div className="flex items-center justify-end gap-1">
                    <form action={resetAction} className="inline">
                      <input type="hidden" name="id" value={u.id} />
                      <button type="submit" title="Gerar nova senha temporária"
                        className="rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-sky-300">
                        <KeyRound className="size-4" />
                      </button>
                    </form>
                    {u.role !== 'admin' && (
                      <form action={deleteUser} className="inline">
                        <input type="hidden" name="id" value={u.id} />
                        <button type="submit" title="Excluir usuário"
                          className="rounded-md p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400">
                          <Trash2 className="size-4" />
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Add user */}
      <section className="panel px-5 py-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
          <UserPlus className="size-4 text-sky-400" /> Adicionar membro
        </h2>
        <form action={addAction} className="flex flex-wrap items-center gap-2">
          <input name="name" placeholder="Nome completo" required className={input} />
          <input name="email" type="email" placeholder="email@empresa.com.br" required className={`${input} min-w-[220px]`} />
          <button type="submit" disabled={adding}
            className="flex items-center gap-2 rounded-lg bg-sky-500/90 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:opacity-60">
            {adding && <Loader2 className="size-4 animate-spin" />} Criar conta
          </button>
        </form>
        {addState.error && <p className="mt-2 text-xs text-red-400">{addState.error}</p>}
        <p className="mt-2 text-[11px] text-slate-600">
          Gera uma senha temporária para entrega segura. O sistema não envia e-mail.
        </p>
      </section>
    </div>
  );
}
