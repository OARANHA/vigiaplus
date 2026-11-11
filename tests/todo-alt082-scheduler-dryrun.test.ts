import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const runner = resolve('scripts/workers/notify-supervised.ts');

test('ALT-08.2: duas passadas dry-run sem envio e com histórico separado do worker real', async () => {
  const root = mkdtempSync(join(tmpdir(),'vigia-alt082-'));
  const dataDir=join(root,'database');
  const stateDir=join(root,'state');
  try {
    const env={...process.env, VIGIA_NOTIFY_SCHEDULER:'1',VIGIA_NOTIFY_DRY_RUN:'1',
      VIGIA_NOTIFY_STATE_DIR:stateDir,PGLITE_DIR:dataDir,DEMO_MODE:'0',
      DATABASE_URL:''};
    for(let n=0;n<2;n++){
      const r=spawnSync(process.execPath,['--import','tsx',runner],{
        cwd:process.cwd(),env,encoding:'utf8',timeout:60000,
      });
      assert.equal(r.status,0,'dry-run deve terminar com sucesso: '+(r.stderr??'').slice(0,250));
      const report=JSON.parse(r.stdout.trim()) as {worker:string;summary:Record<string,unknown>};
      assert.equal(report.worker,'notify_dry_run');
      assert.equal(report.summary.dryRun,true);
      assert.deepEqual(report.summary.entregas,{sent:0,failed:0});
      assert.equal(existsSync(join(stateDir,'notify.lock')),false);
    }
    const latest=JSON.parse(readFileSync(join(stateDir,'latest.json'),'utf8')) as {worker:string};
    assert.equal(latest.worker,'notify_dry_run');
    // Após término dos subprocessos, o diretório PGlite está liberado.
    process.env.PGLITE_DIR=dataDir;delete process.env.DATABASE_URL;delete process.env.DEMO_MODE;
    const {getDb}=await import('../lib/db');
    const {notificationWorkerRuns,notificationDeliveries}=await import('../lib/db/schema');
    const {eq}=await import('drizzle-orm');
    const db=await getDb();
    const runs=await db.select().from(notificationWorkerRuns)
      .where(eq(notificationWorkerRuns.worker,'notify_dry_run'));
    assert.equal(runs.length,2);
    assert.ok(runs.every(r=>r.status==='success'));
    assert.equal((await db.select().from(notificationWorkerRuns)
      .where(eq(notificationWorkerRuns.worker,'notify'))).length,0,
      'simulação nunca pode produzir health de entrega real');
    assert.equal((await db.select().from(notificationDeliveries)).length,0,
      'simulação não cria nem despacha mensagens');
  } finally {
    // Evitar remoção do diretório enquanto a conexão de teste estiver aberta.
    if(!existsSync(dataDir))rmSync(root,{recursive:true,force:true});
  }
});
