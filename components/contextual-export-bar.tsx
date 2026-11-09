'use client';

import { usePathname } from 'next/navigation';
import { ExportBar } from '@/components/export-bar';
import type { Locale } from '@/lib/i18n-dict';

/** A barra de exportação pertence à área analítica, não ao console do dono. */
export function ContextualExportBar(props: { locale: Locale; canUseStudio: boolean }) {
  const pathname = usePathname();
  if (pathname === '/console' || pathname.startsWith('/console/')) return null;
  return <ExportBar {...props} />;
}
