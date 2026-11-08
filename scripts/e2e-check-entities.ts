import { getDb } from '../lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  const result = await db.execute(sql`SELECT name FROM benchmark_entities WHERE name LIKE 'qa-%'`);
  const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
  if (client?.close) await client.close();
  console.log(JSON.stringify(result.rows));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
