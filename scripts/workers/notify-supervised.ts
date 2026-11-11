/**
 * ALT-08: invocação pontual do worker de alertas sob um agendador externo.
 * NÃO é daemon e NÃO agenda nada sozinho. Desativado por padrão.
 * O lock é local ao host; a outbox/claims SQL é a barreira entre instâncias.
 */
import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

type State = {
  worker: 'notify' | 'notify_dry_run';
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'success' | 'error' | 'timeout';
  exitCode: number | null;
  // Mensagens do provedor, destinatários e segredos nunca entram no arquivo.
  summary?: Record<string, unknown>;
};
const folder = resolve(process.env.VIGIA_NOTIFY_STATE_DIR || '.data/notify');
const lockPath = resolve(folder, 'notify.lock');
const statePath = resolve(folder, 'latest.json');
const maxMs = 180_000;

function enabled(): boolean {
  return process.env.VIGIA_NOTIFY_SCHEDULER === '1'
    && process.env.DEMO_MODE !== '1';
}

async function writeState(state: State) {
  const temp = resolve(folder, `latest.${state.runId}.tmp`);
  await writeFile(temp, JSON.stringify(state) + '\n', { mode: 0o600 });
  await rename(temp, statePath);
}

const orphanThresholdMs = 5 * 60_000;

/**
 * Recuperação somente para SIMULAÇÃO. Em operação real um lock órfão
 * permanece bloqueado até intervenção administrativa explícita.
 * O PID é revalidado e nenhum lock recente ou de processo ativo é removido.
 */
async function recoverDryRunOrphan(): Promise<boolean> {
  if (process.env.VIGIA_NOTIFY_DRY_RUN !== '1') return false;
  let original: string;
  let inode: number;
  try {
    const file = await stat(lockPath);
    inode = file.ino;
    original = await readFile(lockPath, 'utf8');
  } catch { return false; }
  let entry: unknown;
  try { entry = JSON.parse(original); } catch { return false; }
  if (!entry || typeof entry !== 'object') return false;
  const { pid, startedAt } = entry as Record<string, unknown>;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0 || typeof startedAt !== 'string') return false;
  const timestamp = Date.parse(startedAt);
  if (!Number.isFinite(timestamp) || Date.now() - timestamp < orphanThresholdMs) return false;
  // PID ativo, inacessível ou reutilizado: fail closed.
  try { process.kill(Number(pid), 0); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') return false;
  }
  // Proteção best-effort de troca entre leitura e remoção. Lock permanece
  // fail-closed se houver discrepância; sem claims no dry-run.
  try {
    const latest = await stat(lockPath);
    if (latest.ino !== inode || await readFile(lockPath, 'utf8') !== original) return false;
    await rm(lockPath);
    return true;
  } catch { return false; }
}

async function lock(): Promise<() => Promise<void>> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  // Exclusividade local, não distribuída. Um lock órfão exige supervisão.
  const handle = await open(lockPath, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify({
      pid: process.pid, startedAt: new Date().toISOString(),
    }));
  } finally {
    await handle.close();
  }
  return async () => { await rm(lockPath, { force: true }); };
}

async function main(): Promise<void> {
  if (!enabled()) {
    console.error('notify-supervised: desativado (VIGIA_NOTIFY_SCHEDULER=1 requerido; demo proibida)');
    process.exitCode = 2;
    return;
  }

  let unlock: () => Promise<void>;
  try {
    unlock = await lock();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      if (await recoverDryRunOrphan()) {
        // Segunda tentativa atômica; se outra execução ganhou, EEXIST
        // permanece um resultado seguro, sem trabalho duplo.
        try { unlock = await lock(); }
        catch (retryError) {
          if ((retryError as NodeJS.ErrnoException).code !== 'EEXIST') throw retryError;
          console.error('notify-supervised: lock readquirido por outra execução');
          process.exitCode = 3;
          return;
        }
      } else {
        console.error('notify-supervised: outra execução ou lock não recuperável; nenhuma execução iniciada');
        process.exitCode = 3;
        return;
      }
    } else throw error;
  }

  // Dry-run testa o ciclo do agendador e a persistência, SEM ler fila ou chamar transportes.
  const dryRun = process.env.VIGIA_NOTIFY_DRY_RUN === '1';
  const runId = randomUUID();
  const startedAt = new Date();
  let status: State['status'] = 'error';
  let exitCode: number | null = null;
  let summary: Record<string, unknown> | undefined;

  try {
    if (dryRun) {
      summary = { dryRun: true, tenants: 0, regras: 0, canais: 0,
        fatos: 0, planejados: 0, enfileirados: 0, entregas: { sent: 0, failed: 0 } };
      exitCode = 0;
      status = 'success';
    } else {
    const script = resolve('scripts/workers/notify.ts');
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      env: process.env, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => {
      // Evitar crescimento ilimitado de memória e de logs.
      if (stdout.length < 16384) stdout += chunk.toString('utf8').slice(0, 16384 - stdout.length);
    });
    // Não ecoar stderr: o transportador pode incluir PII nas exceções.
    child.stderr.resume();
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, maxMs);
    timer.unref();
    try {
      exitCode = await new Promise<number | null>((resolveExit, reject) => {
        child.once('error', reject);
        child.once('close', resolveExit);
      });
    } finally {
      clearTimeout(timer);
    }

    if (exitCode === 0 && !timedOut) {
      const line = stdout.trim().split('\n').at(-1);
      try {
        const parsed: unknown = JSON.parse(line || '');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          // Whitelist: não persistir o texto de regras, incidentes ou destinatários.
          const keys = ['tenants', 'regras', 'canais', 'fatos', 'planejados', 'enfileirados'];
          summary = Object.fromEntries(keys.filter(k => typeof obj[k] === 'number')
            .map(k => [k, obj[k]]));
          const deliveries = obj.entregas as Record<string, unknown> | undefined;
          if (deliveries && typeof deliveries.sent === 'number'
            && typeof deliveries.failed === 'number') {
            summary.entregas = { sent: deliveries.sent, failed: deliveries.failed };
          }
        }
      } catch { /* Saída malformada é erro de instrumentação. */ }
      status = summary ? 'success' : 'error';
    } else {
      status = timedOut ? 'timeout' : 'error';
    }
    }
  } finally {
    const result: State = {
      worker: dryRun ? 'notify_dry_run' : 'notify', runId, startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      status, exitCode, ...(summary ? { summary } : {}),
    };
    try {
      await writeState(result);
      // Persistir no banco após terminar o filho. Não registrar PII ou stdout.
      // Uma falha de persistência torna a execução NÃO saudável (fail closed).
      const { getDb } = await import('../../lib/db');
      const { notificationWorkerRuns } = await import('../../lib/db/schema');
      const db = await getDb();
      await db.insert(notificationWorkerRuns).values({
        runId: result.runId, worker: result.worker,
        startedAt: new Date(result.startedAt),
        finishedAt: new Date(result.finishedAt),
        durationMs: result.durationMs, status: result.status,
        exitCode: result.exitCode, summary: result.summary ?? {},
      }).onConflictDoNothing({ target: notificationWorkerRuns.runId });
      console.log(JSON.stringify(result));
    } finally {
      await unlock();
    }
    if (status !== 'success') process.exitCode = 1;
  }
}
main().then(() => {
  // O processo CLI dry-run terminou suas operações e soltou o lock;
  // finalizar explicitamente pois PGlite mantém handles de I/O ativos.
  if (process.env.VIGIA_NOTIFY_DRY_RUN === '1') process.exit(process.exitCode ?? 0);
}).catch(() => {
  // Falha de infraestrutura sem expor caminho/segredo/PII na saída.
  console.error('notify-supervised: falha de infraestrutura; verifique permissões e estado do agendador');
  process.exitCode = 1;
});
