#!/usr/bin/env node
// E2E di SICUREZZA contro il build di produzione (correzioni P0 dell'audit).
//
//   Scenario A — revoca delle sessioni: login → API con cookie OK → revokeAll →
//                cookie VECCHIO rifiutato (401) → revokeAll con cookie revocato
//                rifiutato (401) → nuovo login funziona.
//   Scenario B — utente SENZA progetti: POST /api/refresh → 404 esplicito e
//                NESSUN lock di pipeline nel DB (prima della fix: pipeline
//                GLOBALE su tutti i progetti).
//   Scenario C — DEMO_MODE read-only: refresh speciali, timeline, cron → 403;
//                la home resta visibile (200).
//   Scenario D — boot di produzione SENZA SESSION_SECRET → il server si
//                RIFIUTA di partire (validazione all'avvio).
//
// Credenziali: sintetiche, generate per questo run su un DB usa-e-getta.
// Nessuna credenziale reale viene stampata o salvata.

import { spawn, execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT_AUTH = 3111;
const PORT_DEMO = 3112;
const PORT_BOOT = 3113;
const SESSION_SECRET = randomBytes(32).toString('hex');
const ADMIN_EMAIL = 'e2e-admin@e2e.test';
const ADMIN_PASSWORD = 'e2e-admin-password-123';
const MEMBER_EMAIL = 'member@e2e.test';
const MEMBER_PASSWORD = 'e2e-member-password';

const results = [];
const log = [];
function record(scenario, name, pass, detail) {
  results.push({ scenario, name, pass, detail });
  const line = `${pass ? 'PASS' : 'FAIL'}  [${scenario}] ${name} — ${detail}`;
  console.log(line);
  log.push(line);
}

function waitReady(port, timeoutMs = 60_000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/landing`, { signal: AbortSignal.timeout(2000) });
        if (res.status >= 200 && res.status < 400) return resolve();
      } catch { /* non pronto */ }
      if (Date.now() - t0 > timeoutMs) return reject(new Error(`server :${port} non pronto`));
      setTimeout(poll, 500);
    })();
  });
}

function startServer(port, env) {
  // L'ambiente del sandbox non è affidabile: il server E2E deve ricevere SOLO
  // le variabili decise qui (nessun DATABASE_URL ereditato che dirotterebbe su
  // Neon, nessun DEMO_MODE che resti appiccicato da uno scenario all'altro).
  const clean = { ...process.env };
  clean.DATABASE_URL = '';
  clean.DEMO_MODE = '';
  clean.SESSION_SECRET = '';
  clean.APP_PASSWORD = '';
  clean.PGLITE_DIR = '';
  // detached + gruppo proprio: lo shutdown deve raggiungere ANCHE il vero
  // server (next-server è figlio di npx: uccidere solo npx lascia orfani che
  // tengono il porto occupato — successo nel primo run).
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port)], {
    cwd: ROOT, env: { ...clean, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.unref();
  return { child, getOutput: () => out };
}

function stop(server) {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    server.child.on('exit', fin);
    try { process.kill(-server.child.pid, 'SIGTERM'); } catch { /* già morto */ }
    setTimeout(() => {
      try { process.kill(-server.child.pid, 'SIGKILL'); } catch { /* già morto */ }
      fin();
    }, 5000);
  });
}

async function req(port, path, opts = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body, cookie: setCookie ? setCookie.split(';')[0] : null };
}

function login(port, email, password) {
  return req(port, '/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

function withCookie(r, cookie) {
  return { ...r, headers: { ...(r.headers ?? {}), cookie } };
}

// ───────────────────────── Scenario A + B ─────────────────────────

async function scenarioAuthAndProjectless() {
  const dir = mkdtempSync(join(tmpdir(), 'radar-e2e-auth-'));
  console.log(`\n=== SCENARIO A+B — server :${PORT_AUTH}, DB isolato ${dir} ===`);
  execSync(`node --import tsx scripts/e2e-prepare-db.ts ${dir}`, {
    cwd: ROOT,
    env: {
      ...process.env,
      E2E_MEMBER_EMAIL: MEMBER_EMAIL,
      E2E_MEMBER_PASSWORD: MEMBER_PASSWORD,
      ADMIN_EMAIL, ADMIN_PASSWORD,
      SESSION_SECRET,
      PGLITE_DIR: dir,
      DATABASE_URL: '',
    },
    stdio: 'inherit',
  });

  const server = startServer(PORT_AUTH, {
    PGLITE_DIR: dir,
    SESSION_SECRET,
    ADMIN_EMAIL, ADMIN_PASSWORD,
    NODE_ENV: 'production',
  });
  try {
    await waitReady(PORT_AUTH);

    // A1 — login admin
    const login1 = await login(PORT_AUTH, ADMIN_EMAIL, ADMIN_PASSWORD);
    record('A', 'A1 login admin → 200 + cookie di sessione', login1.status === 200 && !!login1.cookie,
      `status=${login1.status} cookie=${login1.cookie ? 'emesso' : 'MANCANTE'}`);
    const cookie = login1.cookie;

    // A2 — il cookie VALIDO accede a un endpoint protetto
    const ok1 = await req(PORT_AUTH, '/api/locale', withCookie({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"locale":"pt"}' }, cookie));
    record('A', 'A2 cookie valido → API protetta risponde 200', ok1.status === 200,
      `POST /api/locale → ${ok1.status} ${JSON.stringify(ok1.body)}`);

    // A3 — revokeAll con sessione VIVA
    const rev = await req(PORT_AUTH, '/api/auth', withCookie({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"revokeAll":true}' }, cookie));
    record('A', 'A3 revokeAll con sessione viva → 200', rev.status === 200,
      `status=${rev.status} body=${JSON.stringify(rev.body)}`);

    // A4 — il cookie ORA revocato è rifiutato dall'API (nonostante firma valida)
    const after = await req(PORT_AUTH, '/api/locale', withCookie({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"locale":"pt"}' }, cookie));
    record('A', 'A4 cookie REVOCATO → API protetta risponde 401', after.status === 401,
      `POST /api/locale → ${after.status} ${JSON.stringify(after.body)}`);

    // A5 — revokeAll con cookie REVOCATO → rifiutato (fix dell'audit)
    const rev2 = await req(PORT_AUTH, '/api/auth', withCookie({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"revokeAll":true}' }, cookie));
    record('A', 'A5 revokeAll con cookie REVOCATO → 401 (fix audit)', rev2.status === 401,
      `status=${rev2.status} body=${JSON.stringify(rev2.body)}`);

    // A6 — nuovo login → sessione fresca che funziona
    const login2 = await login(PORT_AUTH, ADMIN_EMAIL, ADMIN_PASSWORD);
    const ok2 = await req(PORT_AUTH, '/api/locale', withCookie({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"locale":"pt"}' }, login2.cookie));
    record('A', 'A6 nuovo login → cookie fresco accettato (200)', login2.status === 200 && ok2.status === 200,
      `login=${login2.status} /api/locale=${ok2.status}`);

    // B — member SENZA progetti
    const mlogin = await login(PORT_AUTH, MEMBER_EMAIL, MEMBER_PASSWORD);
    record('B', 'B1 login member senza progetti → 200', mlogin.status === 200,
      `status=${mlogin.status} cookie=${mlogin.cookie ? 'emesso' : 'MANCANTE'}`);
    const mcookie = mlogin.cookie;

    const refresh = await req(PORT_AUTH, '/api/refresh', withCookie({ method: 'POST' }, mcookie));
    record('B', 'B2 member senza progetti: POST /api/refresh → 404 esplicito (MAI pipeline globale)',
      refresh.status === 404, `status=${refresh.status} body=${JSON.stringify(refresh.body)}`);

    const revRefresh = await req(PORT_AUTH, '/api/reviews/refresh', withCookie({ method: 'POST' }, mcookie));
    record('B', 'B3 member senza progetti: POST /api/reviews/refresh → 404', revRefresh.status === 404,
      `status=${revRefresh.status}`);

    const revRefreshAnon = await req(PORT_AUTH, '/api/refresh', { method: 'POST' });
    record('B', 'B4 SENZA cookie: POST /api/refresh → 401 (proxy) e mai esecuzione',
      revRefreshAnon.status === 401, `status=${revRefreshAnon.status} body=${JSON.stringify(revRefreshAnon.body)}`);
  } finally {
    await stop(server);
    // B5 — prova differenziale sul DB: NESSUN lock di pipeline scritto
    try {
      const out = execSync(`node --import tsx scripts/e2e-check-locks.ts ${dir}`, {
        cwd: ROOT, env: { ...process.env, PGLITE_DIR: dir, DATABASE_URL: '' }, encoding: 'utf8',
      });
      const { locks } = JSON.parse(out.trim());
      record('B', 'B5 DB: zero lock di pipeline dopo i tentativi (nessuna esecuzione globale)',
        locks === 0, `righe in meta con key LIKE 'pipeline_lock%' = ${locks}`);
    } catch (e) {
      record('B', 'B5 DB: zero lock di pipeline dopo i tentativi', false, `errore verifica: ${e.message}`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────── Scenario C — DEMO read-only ─────────────────────────

async function scenarioDemo() {
  const dir = mkdtempSync(join(tmpdir(), 'radar-e2e-demo-'));
  console.log(`\n=== SCENARIO C — DEMO_MODE=1, server :${PORT_DEMO}, DB isolato ${dir} ===`);
  const server = startServer(PORT_DEMO, { PGLITE_DIR: dir, DEMO_MODE: '1', SESSION_SECRET, NODE_ENV: 'production' });
  try {
    await waitReady(PORT_DEMO);
    const home = await req(PORT_DEMO, '/');
    record('C', 'C0 demo: home visibile (200)', home.status === 200, `GET / → ${home.status}`);

    const endpoints = [
      ['/api/refresh', 'refresh globale on-demand'],
      ['/api/reviews/refresh', 'ingestione recensioni (Google/Yelp)'],
      ['/api/wikipedia/refresh', 'ingestione edit Wikipedia'],
      ['/api/facts/refresh', 'ingestione fact-check'],
      ['/api/trials/refresh', 'ingestione studi clinici'],
      ['/api/sport/refresh', 'ingestione partite'],
      ['/api/timeline', 'estrazione timeline (persistenza)'],
      ['/api/pov', 'rigenerazione tesi (AI+persistenza)'],
      ['/api/brief', 'rigenerazione brief (AI+persistenza)'],
      ['/api/insights/clusters', 'rigenerazione cluster (AI+persistenza)'],
      ['/api/influencer', 'profilo influencer (AI+persistenza)'],
      ['/api/playbook', 'playbook alert (AI+persistenza)'],
      ['/api/translate', 'traduzione mention (AI+persistenza cache)'],
    ];
    let i = 1;
    for (const [path, why] of endpoints) {
      const r = await req(PORT_DEMO, path, { method: 'POST' });
      record('C', `C${i} demo: POST ${path} → 403 (${why})`, r.status === 403,
        `status=${r.status} body=${JSON.stringify(r.body)}`);
      i += 1;
    }
    const cron = await req(PORT_DEMO, '/api/cron/daily');
    record('C', `C14 demo: GET /api/cron/daily → 403 (cron disattivato)`, cron.status === 403,
      `status=${cron.status} body=${JSON.stringify(cron.body)}`);
  } finally {
    await stop(server);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────── Scenario D — boot senza segreto ─────────────────────────

async function scenarioBootSecret() {
  console.log(`\n=== SCENARIO D — boot di produzione SENZA SESSION_SECRET, porta :${PORT_BOOT} ===`);
  const dir = mkdtempSync(join(tmpdir(), 'radar-e2e-boot-'));
  const server = startServer(PORT_BOOT, { PGLITE_DIR: dir, NODE_ENV: 'production' }); // nessun SESSION_SECRET, nessun DEMO_MODE
  const t0 = Date.now();
  let refused = false;
  let output = '';
  try {
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        output = server.getOutput();
        if (/SESSION_SECRET is required|Invalid SESSION_SECRET/i.test(output)) {
          refused = true; clearInterval(iv); resolve();
        } else if (Date.now() - t0 > 45_000) { clearInterval(iv); resolve(); }
      }, 500);
    });
    // un eventuale server rimasto in vita va spento comunque
    const stillUp = await fetch(`http://127.0.0.1:${PORT_BOOT}/landing`).then(() => true).catch(() => false);
    record('D', 'D1 produzione senza SESSION_SECRET → boot RIFIUTATO con messaggio esplicito',
      refused && !stillUp,
      refused ? `il server ha stampato la validazione e non serve alcuna pagina (serving=${stillUp})`
        : `NESSUN rifiuto rilevato (serving=${stillUp}). Output: ${output.slice(-400)}`);
  } finally {
    await stop(server);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────── main ─────────────────────────

const t0 = Date.now();
// Only child process groups started by this runner are stopped. Never kill other Next.js servers.
await scenarioAuthAndProjectless();
await scenarioDemo();
await scenarioBootSecret();

const failed = results.filter((r) => !r.pass);
const summary = [
  `E2E di sicurezza — ${results.length} controlli, ${results.length - failed.length} PASS, ${failed.length} FAIL`,
  `Durata: ${((Date.now() - t0) / 1000).toFixed(1)}s · Credenziali sintetiche su DB usa-e-getta (nessun segreto reale)`,
];
console.log('\n' + summary.join('\n'));
if (failed.length) {
  console.log('\nFALLITI:');
  failed.forEach((f) => console.log(`  [${f.scenario}] ${f.name} — ${f.detail}`));
}

const evidenceDir = process.env.RADAR_E2E_EVIDENCE_DIR ?? join(ROOT, 'docs/research/evidence/e2e-security', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(join(evidenceDir, 'e2e-security.log'),
  [...summary, '', ...log].join('\n') + '\n');
console.log(`\nEvidenza salvata: ${evidenceDir}/e2e-security.log`);
process.exit(failed.length ? 1 : 0);
