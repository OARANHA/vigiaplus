/**
 * Canary de homologação: consultas públicas reais, DB PGlite descartável,
 * sem qualquer escrita em produção ou chaves. Resultado NÃO aprova fonte sozinho.
 * O runner CI mantém este passo não-bloqueante por depender de terceiros.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, desc } from 'drizzle-orm';

async function main() {
const tmp = mkdtempSync(join(tmpdir(), 'vigia-live-canary-'));
process.env.PGLITE_DIR = tmp;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

let report: Record<string, unknown> = {
  timestamp: new Date().toISOString(), type: 'real_public_source_smoke',
  synthetic: false, result: 'not_executed',
};

try {
  const [{ getDb }, { ensureCrfrsPilot }, { collectProject }, schema] = await Promise.all([
    import('../lib/db'), import('../lib/vigia/pilot'),
    import('../lib/vigia/collection'), import('../lib/db/schema'),
  ]);
  const db = await getDb();
  const project = await ensureCrfrsPilot(1);
  const first = await collectProject(project);
  // Segunda coleta apenas Google News evita multiplicar chamadas ao GDELT.
  const second = await collectProject({ ...project, enabledSources: ['googlenews'] });
  const attempts = await db.select().from(schema.collectionRunSources)
    .where(eq(schema.collectionRunSources.projectId, project.id))
    .orderBy(desc(schema.collectionRunSources.startedAt));
  const articles = await db.select().from(schema.mentions)
    .where(eq(schema.mentions.projectId, project.id))
    .orderBy(desc(schema.mentions.publishedAt)).limit(8);
  const client = (db as unknown as { $client?: { close: () => Promise<void> } }).$client;
  if (client?.close) await client.close();
  report = {
    timestamp: new Date().toISOString(), type: 'real_public_source_smoke',
    synthetic: false, projectId: project.id, first, second,
    attempts: attempts.map((a) => ({
      source: a.source, query: a.query, status: a.status, raw: a.rawCount,
      accepted: a.acceptedCount, newMentions: a.newCount,
      duplicates: a.duplicateCount, discarded: a.discardedCount,
      discardReasons: a.discardReasons, httpStatus: a.httpStatus,
      error: a.error, durationMs: a.durationMs, lastSuccessAt: a.lastSuccessAt,
    })),
    articleSample: articles.map((a) => ({
      source: a.source, title: a.title, url: a.url,
      publishedAt: a.publishedAt.toISOString(),
    })),
    result: first.status === 'failed' ? 'blocked_by_upstream' : 'collected_with_diagnostics',
    note: 'Sem validação humana dos falsos positivos nem interface visual, esta saída não é aceite final.',
  };
} catch (e) {
  report = { ...report, result: 'execution_error', error:
    String(e instanceof Error ? e.message : e).replace(/https?:\/\/\S+/g, '[URL removida]').slice(0, 250) };
} finally {
  const path = process.env.RADAR_E2E_EVIDENCE_DIR ?? join(tmpdir(), 'vigia-evidence');
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'vigia-live-canary.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  rmSync(tmp, { recursive: true, force: true });
}

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
