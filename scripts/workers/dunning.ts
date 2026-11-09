import { runDunning } from '../../lib/billing/dunning';
import { dispatchPending } from '../../lib/notifications/queue';

/** Worker de cobranca: `npm run worker:dunning`. Idempotente, pode rodar em cron. */
async function main() {
  const report = await runDunning();
  const delivery = await dispatchPending();
  console.log(JSON.stringify({
    worker: 'dunning',
    ...report,
    entregas: delivery,
    executadoEm: new Date().toISOString(),
  }));
}

main().catch((e) => {
  console.error('worker:dunning FALHOU —', e);
  process.exitCode = 1;
});
