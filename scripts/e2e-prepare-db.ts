// Preparazione del database isolato per l'E2E di sicurezza.
// Apre un PGlite usa-e-getta in una directory temporanea, lascia che il seed
// dell'app crei admin + progetto dimostrativo, e aggiunge un MEMBER SENZA
// progetti (lo scenario dell'audit: l'utente che non deve poter innescare
// una pipeline globale). Credenziali sintetiche, solo per questo test.
// Uso: node --import tsx scripts/e2e-prepare-db.ts <PGLITE_DIR>
import { eq } from 'drizzle-orm';

async function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('uso: tsx scripts/e2e-prepare-db.ts <PGLITE_DIR>');
  process.env.PGLITE_DIR = dir;
  delete process.env.DATABASE_URL;
  delete process.env.DEMO_MODE;

  const { getDb } = await import('../lib/db');
  const { users } = await import('../lib/db/schema');
  const { hashPassword } = await import('../lib/password');

  const db = await getDb();
  const email = process.env.E2E_MEMBER_EMAIL ?? 'member@e2e.test';
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (!existing) {
    await db.insert(users).values({
      name: 'Member senza progetti',
      email,
      role: 'member',
      aiEnabled: 1,
      mustChangePassword: 0,
      passwordHash: hashPassword(process.env.E2E_MEMBER_PASSWORD ?? 'e2e-member-password'),
    });
    console.log(`member inserito: ${email} (nessun progetto)`);
  } else {
    console.log(`member già presente: ${email}`);
  }
  const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
  if (client?.close) await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
