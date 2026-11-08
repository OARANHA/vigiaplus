// Verifica differenziale per l'E2E: dopo i tentativi di /api/refresh di un
// utente SENZA progetti, nel database isolato NON deve esistere alcun lock
// di pipeline (prima della fix il fallback globale scriveva 'pipeline_lock').
// Uso: node --import tsx scripts/e2e-check-locks.ts <PGLITE_DIR>
import { sql } from 'drizzle-orm';

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('uso: tsx scripts/e2e-check-locks.ts <PGLITE_DIR>');
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.DEMO_MODE;

  const { getDb } = await import('../lib/db');
  const db = await getDb();
  const locks = await db.execute(sql`SELECT key FROM meta WHERE key LIKE 'pipeline_lock%'`);
  console.log(JSON.stringify({ locks: locks?.rows?.length ?? 0 }));
  const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
  if (client?.close) await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
