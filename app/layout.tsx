import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
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
  title: {
    default: 'VigiaPlus — Inteligência e monitoramento',
    template: '%s — VigiaPlus',
  },
  description: 'Monitoramento de fontes, reputação e inteligência de comunicação.',
};

// Tutte le pagine leggono dal database a ogni richiesta: niente prerender statico.
export const dynamic = 'force-dynamic';

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [projects, current, lastIngest, user] = await Promise.all([
    getProjects(), getCurrentProject(), getLastIngestAt(), getCurrentUser(),
  ]);
  const alertCount = current ? await getRecentAlertCount(current.id) : 0;
  const peopleCount = current ? await countPeople(current.id) : 0;
  const pulse = current ? await getPulse(current.id) : { mentions24h: 0, sentiment: null };
  const stale = !lastIngest || Date.now() - lastIngest.getTime() > 2 * 3600_000;

  const demo = process.env.DEMO_MODE === '1';
  const locale = await getLocale();
  const t = await getT();
  // Le date lato server seguono la lingua scelta (fmtDate legge questo tag).
  setServerLocaleTag(locale);

  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        {demo && (
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-sky-500/15 px-4 py-2 text-center text-xs text-sky-200">
            <span>🛰️ <strong>{t('demo.live', 'Demonstração')}</strong> — {t('demo.banner', 'Dados de exemplo, somente leitura. Os recursos de IA dependem de configuração própria.')}</span>
            <a href="https://github.com/OARANHA/vigiaplus" target="_blank" rel="noopener noreferrer"
              className="rounded-full bg-sky-500/90 px-3 py-0.5 font-semibold text-slate-950 transition hover:bg-sky-400">
              ⭐ GitHub
            </a>
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
