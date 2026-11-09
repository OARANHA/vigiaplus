'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserCog, Users, Database, Wallet, Scale } from 'lucide-react';

const TABS = [
  { href: '/impostazioni/account', label: 'Minha conta', icon: UserCog, adminOnly: false },
  { href: '/impostazioni/team', label: 'Equipe', icon: Users, adminOnly: true },
  { href: '/impostazioni/fonti', label: 'Fontes', icon: Database, adminOnly: false },
  { href: '/impostazioni/budget', label: 'Orçamento', icon: Wallet, adminOnly: false },
  { href: '/impostazioni/credits', label: 'Créditos e informações legais', icon: Scale, adminOnly: false },
] as const;

export function SettingsTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <div aria-label="Seções das configurações" className="mb-5 flex flex-wrap gap-1 overflow-x-auto border-b border-[var(--border)]">
      {TABS.filter((t) => !t.adminOnly || isAdmin).map(({ href, label, icon: Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2 text-sm transition ${
              active
                ? 'border-[var(--border)] bg-[var(--panel)] font-medium text-sky-300'
                : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
