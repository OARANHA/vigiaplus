import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const runner = resolve('scripts/workers/notify-supervised.ts');

function runDry(env: NodeJS.ProcessEnv): Promise<{status:number|null;signal:NodeJS.Signals|null;stdout:string;stderr:string}> {
  return new Promise((done,fail)=>{
    const child=spawn(process.execPath,['--import','tsx',runner],{
      cwd:process.cwd(), env, stdio:['ignore','pipe','pipe'],shell:false,
    });
    let stdout='';let stderr='';
    child.stdout.on('data',(b:Buffer)=>{if(stdout.length<5000)stdout+=b.toString('utf8');});
    child.stderr.on('data',(b:Buffer)=>{if(stderr.length<5000)stderr+=b.toString('utf8');});
    const timeout=setTimeout(()=>{
      child.kill('SIGKILL');
    },120000);
    child.on('error',e=>{clearTimeout(timeout);fail(e);});
    child.on('close',(status,signal)=>{clearTimeout(timeout);done({status,signal,stdout,stderr});});
  });
}

test('ALT-08.2: dry-run em dois processos registra histórico sem transportar alertas', async () => {
  const root=mkdtempSync(join(tmpdir(),'vigia-alt082-'));
  const dataDir=join(root,'database'), stateDir=join(root,'state');
  try{
    const env={...process.env,VIGIA_NOTIFY_SCHEDULER:'1',VIGIA_NOTIFY_DRY_RUN:'1',
      VIGIA_NOTIFY_STATE_DIR:stateDir,PGLITE_DIR:dataDir,DEMO_MODE:'0',
      DATABASE_URL:''};
    for(let n=0;n<2;n++){
      const r=await runDry(env);
      assert.equal(r.status,0,'dry-run '+(n+1)+' failed; signal='+r.signal+' stderr='+r.stderr.slice(0,250));
      const report=JSON.parse(r.stdout.trim()) as {worker:string;summary:Record<string,unknown>};
      assert.equal(report.worker,'notify_dry_run');
      assert.equal(report.summary.dryRun,true);
      assert.deepEqual(report.summary.entregas,{sent:0,failed:0});
      assert.equal(existsSync(join(stateDir,'notify.lock')),false);
    }
    const latest=JSON.parse(readFileSync(join(stateDir,'latest.json'),'utf8')) as {worker:string};
    assert.equal(latest.worker,'notify_dry_run');
    // Consulta PGlite direta, com close explícito para não deixar handles abertos.
    const db=new PGlite(dataDir);
    try{
      const runs=await db.query<{worker:string;status:string}>(
        "SELECT worker,status FROM notification_worker_runs ORDER BY finished_at");
      assert.equal(runs.rows.length,2);
      assert.ok(runs.rows.every(r=>r.worker==='notify_dry_run'&&r.status==='success'));
      const deliveries=await db.query<{total:number}>(
        "SELECT count(*)::integer AS total FROM notification_deliveries");
      assert.equal(deliveries.rows[0].total,0);
    }finally{await db.close();}
  }finally{rmSync(root,{recursive:true,force:true});}
});
