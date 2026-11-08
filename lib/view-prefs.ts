import { cookies } from 'next/headers';

// Preferencias de VISUALIZACAO por dispositivo (ADR-03).
// Ficam em cookie alem do banco por dois motivos:
//   1. no demo o usuario e sintetico e nao tem linha em users;
//   2. a preferencia e daquele navegador, nao da conta (um celular pode
//      ficar no modo basico enquanto o desktop fica no avancado).
// IMPORTANTE: este cookie so alimenta density/vocabulary/locale.
// NUNCA e lido por RBAC, entitlements ou resolucao de tenant (invariante A4).
export const VIEW_PREFS_COOKIE = 'vp_view';

export type ViewPrefs = {
  density?: 'basico' | 'avancado';
  vocabulary?: 'leigo' | 'tecnico';
  locale?: string;
};

export async function readViewPrefs(): Promise<ViewPrefs> {
  try {
    const store = await cookies();
    const raw = store.get(VIEW_PREFS_COOKIE)?.value;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ViewPrefs;
    return {
      density: parsed.density === 'avancado' ? 'avancado' : parsed.density === 'basico' ? 'basico' : undefined,
      vocabulary: parsed.vocabulary === 'tecnico' ? 'tecnico' : parsed.vocabulary === 'leigo' ? 'leigo' : undefined,
      locale: typeof parsed.locale === 'string' ? parsed.locale.slice(0, 10) : undefined,
    };
  } catch {
    return {};
  }
}
