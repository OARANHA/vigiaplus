/**
 * ALT-08.1 worker subprocess for disposable PostgreSQL CI only.
 * Deliberately never calls dispatchPending or any external transport.
 */
import { createRequire } from 'node:module';
import { drizzle } from 'drizzle-orm/node-postgres';
import { claimPendingDeliveries, finishClaimedDelivery } from '../../lib/notifications/queue';
import * as schema from '../../lib/db/schema';
import type { DB } from '../../lib/db';

if (process.env.ALT081_EPHEMERAL_POSTGRES !== '1'
    || process.env.PGHOST !== '127.0.0.1'
    || process.env.PGDATABASE !== 'vigia_alt081_ci'
    || process.env.DATABASE_URL) {
  throw new Error('Banco PostgreSQL efêmero obrigatório; acesso remoto negado');
}
const mode = process.argv[2];
if (mode !== 'crash-after-claim' && mode !== 'recover-and-finish')
  throw new Error('Modo inválido');
const require = createRequire(import.meta.url);
const { Pool } = require('pg') as { Pool: new (options:Record<string,unknown>)=> {
  end():Promise<void>;
  query(query:string):Promise<unknown>;
}};
const pool = new Pool({
  host:'127.0.0.1',port:5432,database:'vigia_alt081_ci',
  user:'vigia_ci',password:process.env.PGPASSWORD,max:1,
});
const db = drizzle(pool as never, {schema}) as unknown as DB;
const workerId = mode === 'crash-after-claim'
  ? 'worker_alt081_process_crash' : 'worker_alt081_process_recover';

async function main():Promise<void> {
  const [claimed] = await claimPendingDeliveries(db,1,workerId);
  if (!claimed) {
    process.stdout.write('no-claim\n');
    await pool.end();
    return;
  }
  if (mode === 'crash-after-claim') {
    // SIGKILL kills the process before completion, preserving its SQL lease.
    process.kill(process.pid,'SIGKILL');
    return;
  }
  const outcome = await finishClaimedDelivery(db,claimed,workerId,
    {ok:true,detail:'HTTP 202'});
  if(outcome!=='accepted')throw new Error('Não conseguiu finalizar após recovery: '+outcome);
  process.stdout.write('accepted\n');
  await pool.end();
}
main().catch(async()=>{process.exitCode=1;await pool.end();});
