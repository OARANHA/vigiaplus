/**
 * Verify persisted history AFTER ephemeral systemd timer stopped.
 * Standalone read-only inspection of disposable PGlite, no app credentials.
 */
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const directory=process.env.PGLITE_DIR;
if (process.env.CI!=='true' || process.env.GITHUB_ACTIONS!=='true'
    || process.env.DATABASE_URL || !directory
    || !process.env.RUNNER_TEMP || !directory.startsWith(process.env.RUNNER_TEMP+'/')) {
  throw new Error('ALT082 verifier only allowed in isolated GitHub CI PGlite');
}
async function main():Promise<void> {
const db=new PGlite(directory);
try {
  const result=await db.query<{
    worker:string; status:string; run_id:string; summary:unknown;
  }>('SELECT worker,status,run_id,summary FROM notification_worker_runs ORDER BY finished_at');
  assert.ok(result.rows.length>=3,
    'timer needs at least three complete persisted scheduled executions');
  assert.equal(new Set(result.rows.map(r=>r.run_id)).size,result.rows.length);
  assert.ok(result.rows.every(r=>r.worker==='notify_dry_run' && r.status==='success'));
  assert.ok(result.rows.every(r=>{
    const summary=(typeof r.summary==='string'?JSON.parse(r.summary):r.summary) as Record<string,unknown>;
    return summary?.dryRun===true;
  }));
  const messages=await db.query<{n:number}>(
    'SELECT count(*)::integer AS n FROM notification_deliveries');
  assert.equal(messages.rows[0].n,0,'timer never enqueues or sends');
  process.stdout.write(JSON.stringify({scheduledDryRuns:result.rows.length,deliveries:0})+'\n');
}finally{
  await db.close();
}
}
main().catch(() => {
  // Não expor dados internos do PGlite ou caminhos do runner em logs públicos.
  console.error('ALT082: auditoria de histórico systemd falhou');
  process.exitCode=1;
});
