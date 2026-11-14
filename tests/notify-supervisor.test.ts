import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const entry = resolve('scripts/workers/notify-supervised.ts');

function run(env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', entry], {
    cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8',
    timeout: 15000,
  });
}

test('ALT-08 supervisor bloqueia execução sem opt-in e no modo demo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-alt08-'));
  try {
    for (const env of [
      { VIGIA_NOTIFY_SCHEDULER: '0', DEMO_MODE: '0' },
      { VIGIA_NOTIFY_SCHEDULER: '1', DEMO_MODE: '1' },
    ]) {
      const result = run({ ...env, VIGIA_NOTIFY_STATE_DIR: dir });
      assert.equal(result.status, 2);
      assert.equal(existsSync(join(dir, 'notify.lock')), false);
      assert.equal(existsSync(join(dir, 'latest.json')), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALT-08 supervisor recusa lock existente sem iniciar transportes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-alt08-'));
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'notify.lock'), '{"pid":123}');
    const result = run({ VIGIA_NOTIFY_SCHEDULER: '1', DEMO_MODE: '0', VIGIA_NOTIFY_STATE_DIR: dir });
    assert.equal(result.status, 3);
    assert.equal(existsSync(join(dir, 'latest.json')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALT-08.2: dry-run nunca remove lock recente ou de PID ainda ativo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vigia-alt082-lock-'));
  try {
    const cases = [
      { pid: 99999999, startedAt: new Date().toISOString() },
      { pid: process.pid, startedAt: new Date(Date.now()-10*60_000).toISOString() },
      { pid: 99999999 },
      { pid: 99999999, startedAt:'invalid' },
    ];
    for (const item of cases) {
      writeFileSync(join(dir,'notify.lock'),JSON.stringify(item));
      const result=run({
        VIGIA_NOTIFY_SCHEDULER:'1',VIGIA_NOTIFY_DRY_RUN:'1',DEMO_MODE:'0',
        VIGIA_NOTIFY_STATE_DIR:dir,
      });
      assert.equal(result.status,3,JSON.stringify(item));
      assert.equal(existsSync(join(dir,'notify.lock')),true);
      assert.equal(existsSync(join(dir,'latest.json')),false);
    }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
