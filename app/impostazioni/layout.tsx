import { getCurrentUser, isAdmin } from '@/lib/auth';
import { SettingsTabs } from '@/components/settings-tabs';
import { getLocale } from '@/lib/i18n';

// ADR-08: o título acompanha o idioma da sessão (pt-BR primeiro).
export async function generateMetadata() {
  const locale = await getLocale();
  const titles = { it: 'Impostazioni', en: 'Settings', pt: 'Configurações' } as const;
  return { title: titles[locale] };
}

export default async function ImpostazioniLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <div>
      <SettingsTabs isAdmin={isAdmin(user)} />
      {children}
    </div>
  );
}
