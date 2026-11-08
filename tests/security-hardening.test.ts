import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  signSession, verifySession, sessionSecret, safeSecretEqual, type ParsedSession,
} from '../lib/session';
import { cronAuth } from '../lib/cron-auth';

// ---------------------------------------------------------------------------
// INCREMENTO 2 — HARDENING: accesso non autorizzato, segreti, revoca sessioni.
//
// Regola dell'audit: le rotte cron NON devono eseguire operazioni quando il
// segreto è assente o errato in produzione (fail closed). E il cambio password
// revoca ogni sessione emessa prima (versione della sessione nel cookie firmato).
// ---------------------------------------------------------------------------

const ENV_KEYS = ['NODE_ENV', 'CRON_SECRET', 'SESSION_SECRET', 'APP_PASSWORD', 'DEMO_MODE'] as const;
const saved: Record<string, string | undefined> = {};

// process.env.NODE_ENV è tipizzato readonly e i valori assegnati vengono
// coerciti a stringa (undefined diventerebbe "undefined", truthy!): si passa
// dal record sottostante e le chiavi assenti si cancellano davvero.
function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
  else (process.env as Record<string, string | undefined>)[key] = value;
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
});

function setNodeEnv(v: string) { setEnv('NODE_ENV', v); }

function req(headers: Record<string, string> = {}): Request {
  return new Request('https://radar.local/api/cron/daily', { headers });
}

// ── Cron: fail closed in produzione ──

test('cron: in produzione senza CRON_SECRET la rotta si RIFIUTA (fail closed)', () => {
  setNodeEnv('production');
  setEnv('CRON_SECRET', undefined);
  setEnv('DEMO_MODE', undefined);
  const failure = cronAuth(req());
  assert.ok(failure, 'deve rifiutare');
  assert.equal(failure.status, 500);
  assert.equal(failure.reason, 'secret-missing');
});

test('cron: in produzione con segreto ERRATO → 401, nessuna esecuzione', () => {
  setNodeEnv('production');
  setEnv('CRON_SECRET', 'segreto-giusto');
  setEnv('DEMO_MODE', undefined);
  const failure = cronAuth(req({ authorization: 'Bearer sbagliato' }));
  assert.ok(failure);
  assert.equal(failure.status, 401);
  assert.equal(failure.reason, 'secret-mismatch');
});

test('cron: senza header Authorization → 401', () => {
  setNodeEnv('production');
  setEnv('CRON_SECRET', 'segreto-giusto');
  setEnv('DEMO_MODE', undefined);
  assert.equal(cronAuth(req())?.status, 401);
});

test('cron: segreto CORRETTO in produzione → autorizzato (null)', () => {
  setNodeEnv('production');
  setEnv('CRON_SECRET', 'segreto-giusto');
  setEnv('DEMO_MODE', undefined);
  assert.equal(cronAuth(req({ authorization: 'Bearer segreto-giusto' })), null);
});

test('cron: in sviluppo senza segreto resta consentito (sviluppo locale)', () => {
  setNodeEnv('development');
  setEnv('CRON_SECRET', undefined);
  setEnv('DEMO_MODE', undefined);
  assert.equal(cronAuth(req()), null);
});

test('cron: in demo mode le operazioni cron sono VIETATE (read-only)', () => {
  setEnv('DEMO_MODE', '1');
  setEnv('CRON_SECRET', 'segreto');
  setNodeEnv('production');
  const failure = cronAuth(req({ authorization: 'Bearer segreto' }));
  assert.ok(failure);
  assert.equal(failure.status, 403);
  assert.equal(failure.reason, 'demo');
});

// ── SESSION_SECRET obbligatorio in produzione ──

test('sessionSecret: in produzione senza SESSION_SECRET → errore, mai un fallback noto', () => {
  setNodeEnv('production');
  setEnv('SESSION_SECRET', undefined);
  setEnv('APP_PASSWORD', undefined);
  assert.throws(() => sessionSecret(), /SESSION_SECRET is required/);
});

test('sessionSecret: in produzione APP_PASSWORD NON è più un fallback (correzione P0: segreti indipendenti)', () => {
  setNodeEnv('production');
  setEnv('SESSION_SECRET', undefined);
  setEnv('APP_PASSWORD', 'password-di-login-lunga-ma-diversa-1234567890');
  assert.throws(() => sessionSecret(), /SESSION_SECRET is required/,
    'la password di login non può firmare le sessioni');
});

test('sessionSecret: in produzione con SESSION_SECRET esplicito e robusto → usa quello', () => {
  setNodeEnv('production');
  setEnv('SESSION_SECRET', 'f1e2d3c4b5a697886970615243f4e5d6c7b8a99011223344556677889900aabb');
  setEnv('APP_PASSWORD', undefined);
  assert.equal(sessionSecret(), 'f1e2d3c4b5a697886970615243f4e5d6c7b8a99011223344556677889900aabb');
});

test('sessionSecret: in produzione segreto DEBOLE (corto/noto/ripetitivo) → rifiutato', () => {
  setNodeEnv('production');
  setEnv('APP_PASSWORD', undefined);
  setEnv('SESSION_SECRET', 'corto');
  assert.throws(() => sessionSecret(), /at least 32 characters/);
  setEnv('SESSION_SECRET', 'sr-dev-secret-change-me');
  assert.throws(() => sessionSecret(), /SESSION_SECRET/);
  setEnv('SESSION_SECRET', 'a'.repeat(40));
  assert.throws(() => sessionSecret(), /too little variety/);
});

test('sessionSecret: segreto uguale ad APP_PASSWORD → rifiutato (indipendenza obbligatoria)', () => {
  setNodeEnv('production');
  const same = 'f1e2d3c4b5a697886970615243f4e5d6c7b8a99011223344556677889900aabb';
  setEnv('SESSION_SECRET', same);
  setEnv('APP_PASSWORD', same);
  assert.throws(() => sessionSecret(), /must not equal APP_PASSWORD/);
});

test('sessionSecret: fuori produzione il fallback di sviluppo resta (dev only)', () => {
  setNodeEnv('development');
  setEnv('SESSION_SECRET', undefined);
  setEnv('APP_PASSWORD', undefined);
  assert.equal(sessionSecret(), 'sr-dev-secret-change-me');
});

// ── Sessioni revogabili (versione nel cookie firmato) ──

test('sessione: round-trip sign/verify porta userId e versione', () => {
  const cookie = signSession(7, 3);
  const parsed = verifySession(cookie);
  assert.deepEqual(parsed, { userId: 7, version: 3 } satisfies ParsedSession);
});

test('sessione: il bump di versione cambia la firma → il cookie vecchio non passa più il confronto', () => {
  setNodeEnv('development');
  setEnv('SESSION_SECRET', undefined);
  const old = signSession(7, 3);
  const renewed = signSession(7, 4);
  // il cookie vecchio resta FIRMATO bene, ma la sua version (3) non è più
  // quella dell'utente (4): è esattamente ciò che getCurrentUser confronta.
  assert.equal(verifySession(old)?.version, 3);
  assert.equal(verifySession(renewed)?.version, 4);
  assert.notEqual(old, renewed, 'cookie con versione diversa devono differire');
});

test('sessione: formato vecchio "<uid>.<sig>" (senza versione) è RIFIUTATO — revoca di massa al deploy', () => {
  setNodeEnv('development');
  setEnv('SESSION_SECRET', undefined);
  // simula un cookie pre-Incremento 2: firma HMAC del solo userId
  const oldStyle = `7.${signSession(7, 0).split('.')[2]}`;
  assert.equal(verifySession(oldStyle), null);
});

test('sessione: cookie manomesso, malformato o vuoto → null', () => {
  setNodeEnv('development');
  setEnv('SESSION_SECRET', undefined);
  const good = signSession(7, 0);
  const sig = good.split('.')[2];
  const tampered = `8.0.${sig}`; // firma dell'utente 7 applicata all'utente 8
  assert.equal(verifySession(tampered), null, 'la firma non deve passare per un altro userId');
  assert.equal(verifySession('7.0.not-an-hex'), null);
  assert.equal(verifySession('7.0'), null);
  assert.equal(verifySession(''), null);
  assert.equal(verifySession(undefined), null);
  assert.equal(verifySession('x.0.'.concat(sig)), null);
  assert.equal(verifySession('-1.0.'.concat(sig)), null);
});

test('sessione: version negativa o non intera è rifiutata', () => {
  setNodeEnv('development');
  setEnv('SESSION_SECRET', undefined);
  const parts = signSession(7, 0).split('.');
  assert.equal(verifySession(`7.-1.${parts[2]}`), null);
});

// ── Confronto a tempo costante ──

test('safeSecretEqual: uguaglianza e diversità senza cortocircuiti', () => {
  assert.ok(safeSecretEqual('Bearer abc', 'Bearer abc'));
  assert.ok(!safeSecretEqual('Bearer abc', 'Bearer abd'));
  assert.ok(!safeSecretEqual('Bearer abc', 'Bearer abcd')); // lunghezze diverse
});
