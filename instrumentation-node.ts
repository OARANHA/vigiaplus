// Validazione della configurazione all'avvio (SOLO runtime Node.js).
//Questo modulo contiene process.exit, vietato nell'Edge Runtime: per questo
// instrumentation.ts lo importa solo quando NEXT_RUNTIME === 'nodejs'
// (pattern documentato di Next.js per instrumentation con API Node).
export async function registerNode() {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { validateStartupConfig } = await import('@/lib/config-check');
  const check = validateStartupConfig();
  if (!check.ok) {
    // Il solo throw verrebbe ingoiato dal runtime (il server resterebbe in
    // vita): qui si esce DAVVERO — fail closed, come il cron senza segreto.
    console.error(`[startup] ${check.message}`);
    console.error('[startup] configuration invalid: refusing to start (fail closed).');
    process.exit(1);
  }
}
