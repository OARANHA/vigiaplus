import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import localFont from 'next/font/local';
import './globals.css';
import './vigia-client-auth.css';
import { Sidebar } from '@/components/sidebar';
import { getLocale, getT, setServerLocaleTag } from '@/lib/i18n';
import { AutoRefresh } from '@/components/auto-refresh';
import { ContextualExportBar } from '@/components/contextual-export-bar';
import { getCurrentProject, getLastIngestAt, getProjects, getPulse, getRecentAlertCount } from '@/lib/data';
import { LiveFavicon } from '@/components/live-favicon';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { countPeople } from '@/lib/people-insights';

const geistSans = localFont({ src: './fonts/Geist-Variable.woff2', variable: '--font-geist-sans', display: 'swap', weight: '100 900' });
const geistMono = localFont({ src: './fonts/GeistMono-Variable.woff2', variable: '--font-geist-mono', display: 'swap', weight: '100 900' });

export const metadata: Metadata = {
  title: { default: 'VigiaPlus — Inteligência de reputação', template: '%s — VigiaPlus' },
  description: 'Monitoramento de fontes, reputação, comunicação e prevenção de crises.',
};
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [user, locale, requestHeaders] = await Promise.all([getCurrentUser(), getLocale(), headers()]);
  setServerLocaleTag(locale);
  const pathname = requestHeaders.get('x-vigia-request-path') ?? '';
  const demo = process.env.DEMO_MODE === '1';
  const pageIsPublic = !user || pathname.startsWith('/login') || pathname.startsWith('/landing');
  const pageIsClient = pathname === '/portal' || pathname.startsWith('/portal/');
  const customer = !!user && user.globalRole !== 'owner' && user.globalRole !== 'analyst';

  if (customer && !pageIsClient && !pathname.startsWith('/impostazioni/account') && !pageIsPublic) {
    redirect('/portal');
  }
  // Estrutura pública e do cliente NÃO recebem sidebar da administração.
  if (pageIsPublic || pageIsClient || (customer && pathname.startsWith('/impostazioni/account'))) {
    return (
      <html lang={locale === 'pt' ? 'pt-BR' : locale} className={geistSans.variable + ' ' + geistMono.variable + ' h-full antialiased'}>
        <body className="min-h-full">
          {customer && pathname.startsWith('/impostazioni/account') ? (
            <div className="min-h-screen bg-[#0b1120] p-5 text-slate-100 sm:p-10">
              <Link href="/portal" className="mb-6 inline-block text-sm text-violet-300 hover:text-violet-200">
                ← Voltar à área do cliente
              </Link>
              {children}
            </div>
          ) : children}
        </body>
      </html>
    );
  }

  const [projects, current, lastIngest] = await Promise.all([
    getProjects(), getCurrentProject(), getLastIngestAt(),
  ]);
  const alertCount = current ? await getRecentAlertCount(current.id) : 0;
  const peopleCount = current ? await countPeople(current.id) : 0;
  const pulse = current ? await getPulse(current.id) : { mentions24h: 0, sentiment: null };
  const stale = !lastIngest || Date.now() - lastIngest.getTime() > 2 * 3_600_000;
  const t = await getT();

  return (
    <html lang={locale === 'pt' ? 'pt-BR' : locale} className={geistSans.variable + ' ' + geistMono.variable + ' h-full antialiased'}>
      <body className="min-h-full">
        {demo && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-sky-500/15 px-4 py-2 text-center text-xs text-sky-200">
            <span>🛰️ <strong>{t('demo.live', 'Demonstração')}</strong> — {t('demo.banner', 'Dados de exemplo, somente leitura.')}</span>
          </div>
        )}
        <div className="flex min-h-screen flex-col lg:flex-row">
          <Sidebar
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            currentId={current?.id ?? null}
            lastIngest={lastIngest?.toISOString() ?? null}
            alertCount={alertCount}
            peopleCount={peopleCount}
            user={user ? { name: user.name, role: user.role, globalRole: user.globalRole } : null}
            locale={locale}
          />
          <div className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-10 lg:py-6">
            <div className="mx-auto max-w-[1250px]">
              <ContextualExportBar locale={locale} canUseStudio={isAdmin(user)} />
              <main>{children}</main>
            </div>
          </div>
        </div>
        <AutoRefresh stale={!demo && stale} />
        <LiveFavicon sentiment={pulse.sentiment} mentions24h={pulse.mentions24h} alerts={alertCount} />
      </body>
    </html>
  );
}
