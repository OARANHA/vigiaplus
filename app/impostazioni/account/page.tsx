import { getCurrentUser } from '@/lib/auth';
import { PageHeader, EmptyState } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { ChangePasswordForm } from '@/components/change-password-form';

export const metadata = { title: 'Minha conta' };

export default async function AccountPage({ searchParams }: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await getT();
  const user = await getCurrentUser();
  if (!user) return <EmptyState message="Sessão expirada. Entre novamente." />;
  const first = (await searchParams).first === '1';

  return (
    <>
      <PageHeader title={t('page.account.title', 'Minha conta')} />
      <div className="max-w-md">
        <div className="panel mb-4 px-5 py-4 text-sm">
          <p><span className="text-slate-500">Nome:</span> {user.name}</p>
          <p className="mt-1"><span className="text-slate-500">Email:</span> {user.email}</p>
          <p className="mt-1">
            <span className="text-slate-500">Perfil:</span>{' '}
            {user.role === 'admin' ? 'Administrador' : 'Membro'}
            {user.role !== 'admin' && (
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${user.aiEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/15 text-slate-400'}`}>
                IA {user.aiEnabled ? 'ativada' : 'aguardando ativação'}
              </span>
            )}
          </p>
        </div>

        {(first || user.mustChangePassword === 1) && (
          <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-300">
            Você está usando uma senha temporária. Defina uma senha pessoal para continuar com segurança.
          </p>
        )}

        <section className="panel px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">Alterar senha</h2>
          <ChangePasswordForm />
        </section>
      </div>
    </>
  );
}
