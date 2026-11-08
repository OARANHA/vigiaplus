// Instrumentation di Next.js: register() gira una sola volta, quando il
// processo parte. Qui si aggancia la validazione della configurazione di
// produzione (SESSION_SECRET obbligatorio/robusto — correzione P0 dell'audit).
// Il modulo con process.exit (vietato nell'Edge Runtime) vive in
// instrumentation-node.ts e si carica solo nel runtime Node
// (process.env.NEXT_RUNTIME viene risolto a build time: nel bundle edge la
// condizione sparisce insieme all'import).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNode } = await import('./instrumentation-node');
    await registerNode();
  }
}
