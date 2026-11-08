// Server-only database backfill; never import from browser components.
import { countryFromUrl, countryFromDomain } from '@/lib/country-codes';

// ---------------------------------------------------------------------------
// Il recupero dello storico.
//
// Il paese è arrivato dopo: in archivio ci sono mention raccolte quando non lo
// si conservava. Il loro indirizzo però è ancora lì, e un dominio nazionale
// dice da dove viene una testata. Si ripassa a piccoli blocchi, così ogni
// raccolta ne recupera un pezzo senza pesare, finché non ne restano.
// ---------------------------------------------------------------------------

export async function backfillCountries(projectId: number, limit = 25000): Promise<number> {
  const { getDb } = await import('@/lib/db');
  const { sql } = await import('drizzle-orm');
  const db = await getDb();

  const rows = (await db.execute(sql`
    SELECT id, url, author FROM mentions
    WHERE project_id = ${projectId} AND country IS NULL
      AND ((url IS NOT NULL AND url <> '') OR (author IS NOT NULL AND author <> ''))
    LIMIT ${limit}
  `)).rows as { id: number; url: string | null; author: string | null }[];
  if (!rows.length) return 0;

  // Un solo UPDATE per paese: con duemila righe e venti paesi sono venti
  // istruzioni, non duemila.
  const byCountry = new Map<string, number[]>();
  for (const r of rows) {
    // Prima l'indirizzo, poi l'autore: per una notizia di GDELT l'autore È il
    // dominio della testata, ed è l'unico posto in cui il paese è scritto.
    const a2 = countryFromUrl(r.url) ?? countryFromDomain(r.author);
    if (!a2) continue;
    (byCountry.get(a2) ?? byCountry.set(a2, []).get(a2)!).push(r.id);
  }

  let done = 0;
  for (const [a2, ids] of byCountry) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await db.execute(sql`
        UPDATE mentions SET country = ${a2}
        WHERE id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
      `);
      done += chunk.length;
    }
  }
  return done;
}
