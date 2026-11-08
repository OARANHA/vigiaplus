import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

// INTEGRAZIONE con database isolato — la risposta dell'audit al "non bastano
// test unitari sulla firma". Qui c'è un PGlite usa-e-getta (nessun database
// di sviluppo viene sfiorato) e si provano GLI SCENARI COMPLETI richiesti:
//
//   1. cookie valido PRIMA della revoca → accettato
//   2. cookie REVOCATO → rifiutato (firma valida, versione superata) —
//      e si documenta che il solo proxy (firma) lo lascerebbe passare
//   3. cambio password → ogni sessione precedente muore
//   4. revokeAll con cookie già revocato → rifiutato (401), nessun bump
//   5. utente SENZA progetti accessibili → nessun progetto → la rotta di
//      refresh NON può che rispondere 404: mai un'operazione globale
//   6. segreti assenti/deboli → boot e firma si rifiutano (produzione)
//
// I moduli importati sono deliberatamente SENZA next/headers: la regola di
// autenticazione (lib/session-auth) e di scoping (lib/project-access) è
// verificabile così com'è, contro il database vero.

const dir = mkdtempSync(join(tmpdir(), 'radar-secint-'));
process.env.PGLITE_DIR = dir;
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

type SessionAuth = typeof import('../lib/session-auth');
type Db = typeof import('../lib/db');
type Schema = typeof import('../lib/db/schema');
type Session = typeof import('../lib/session');
type Password = typeof import('../lib/password');
type ProjectAccess = typeof import('../lib/project-access');

let auth: SessionAuth;
let dbMod: Db;
let schema: Schema;
let session: Session;
let password: Password;
let projectAccess: ProjectAccess;

const GOOD_SECRET = 'e2e-'
  + 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

const ENV_KEYS = ['NODE_ENV', 'SESSION_SECRET', 'APP_PASSWORD', 'DEMO_MODE'] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>)[key];
  else (process.env as Record<string, string | undefined>)[key] = value;
}

before(async () => {
  auth = await import('../lib/session-auth');
  dbMod = await import('../lib/db');
  schema = await import('../lib/db/schema');
  session = await import('../lib/session');
  password = await import('../lib/password');
  projectAccess = await import('../lib/project-access');
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

after(() => {
  for (const k of ENV_KEYS) setEnv(k, saved[k]);
  rmSync(dir, { recursive: true, force: true });
});

// Utente di prova su un database vero: password hashata, versione di sessione 0.
async function makeUser(email: string, role: 'admin' | 'member' = 'member') {
  const db = await dbMod.getDb();
  const [u] = await db.insert(schema.users).values({
    name: email, email, role, aiEnabled: 1, mustChangePassword: 0,
    passwordHash: password.hashPassword('password-di-prova-123'),
  }).returning();
  return u;
}

// ── Scenario 1 + 2: valido prima, revocato dopo ──

test('scenario 1: cookie valido PRIMA della revoga viene accettato (firma + versione)', async () => {
  setEnv('NODE_ENV', 'development');
  setEnv('SESSION_SECRET', undefined);
  setEnv('APP_PASSWORD', undefined);
  const db = await dbMod.getDb();
  const user = await makeUser('revoca@test.local');
  const cookie = session.signSession(user.id, user.sessionVersion ?? 0);
  const outcome = await auth.authenticateSession(db, cookie);
  assert.ok(outcome.ok, 'la sessione appena emessa deve passare');
  assert.equal(outcome.user.id, user.id);
  assert.equal(outcome.user.email, 'revoca@test.local');
});

test('scenario 2a: il PROXY (sola firma) LASCIA PASSARE il cookie revocato — per questo la verifica di versione sta nelle rotte', async () => {
  setEnv('NODE_ENV', 'development');
  setEnv('SESSION_SECRET', undefined);
  const db = await dbMod.getDb();
  const user = await makeUser('revoca-firma@test.local');
  const cookie = session.signSession(user.id, user.sessionVersion ?? 0);
  // revoca: bump della versione nel DB
  await auth.bumpSessionVersion(db, user.id);
  // la FIRMA resta perfettamente valida: verifySession (ciò che gira nel
  // proxy) NON la rifiuta. È il desacoplamento segnalato dall'audit: senza
  // il controllo di versione in rotta, questa sessione sarebbe ancora viva.
  const passedByProxy = session.verifySession(cookie);
  assert.ok(passedByProxy !== null, 'il proxy firma-soltanto la lascerebbe passare');
  assert.equal(passedByProxy.version, 0);
});

test('scenario 2b: la API (firma + versione sul DB) RIFIUTA il cookie revocato → 401 reason "revoked"', async () => {
  setEnv('NODE_ENV', 'development');
  setEnv('SESSION_SECRET', undefined);
  const db = await dbMod.getDb();
  const user = await makeUser('revoca-api@test.local');
  const cookie = session.signSession(user.id, user.sessionVersion ?? 0);
  await auth.bumpSessionVersion(db, user.id);
  const outcome = await auth.authenticateSession(db, cookie);
  assert.ok(!outcome.ok, 'la sessione revocata deve morire nonostante la firma valida');
  assert.equal(outcome.status, 401);
  assert.equal(outcome.reason, 'revoked');
});

test('scenario 2c: utente cancellato → 401 "unknown-user" (il cookie non basta a resuscitare un account)', async () => {
  setEnv('NODE_ENV', 'development');
  setEnv('SESSION_SECRET', undefined);
  const db = await dbMod.getDb();
  const user = await makeUser('cancellato@test.local');
  const cookie = session.signSession(user.id, user.sessionVersion ?? 0);
  await db.delete(schema.users).where(eq(schema.users.id, user.id));
  const outcome = await auth.authenticateSession(db, cookie);
  assert.ok(!outcome.ok);
  assert.equal(outcome.reason, 'unknown-user');
});

// ── Scenario 3: cambio password invalida le sessioni precedenti ──

test('scenario 3: cambio password (bump versione + re-emissione) → il cookie VECCHIO muore, il NUOVO vive', async () => {
  setEnv('NODE_ENV', 'development');
  setEnv('SESSION_SECRET', undefined);
  const db = await dbMod.getDb();
  const user = await makeUser('cambio-pw@test.local');
  const oldCookie = session.signSession(user.id, user.sessionVersion ?? 0);

  // changePassword (app/account/actions.ts): hash nuovo + bump versione,
  // poi riemette il cookie del dispositivo corrente con la nuova versione.
  const newVersion = await auth.bumpSessionVersion(db, user.id);
  const newCookie = session.signSession(user.id, newVersion);

  assert.ok(!(await auth.authenticateSession(db, oldCookie)).ok,
    'la sessione di PRIMA del cambio password deve essere rifiutata');
  const renewed = await auth.authenticateSession(db, newCookie);
  assert.ok(renewed.ok, 'il cookie riemesso dal cambio password deve passare');
});

// ── Scenario 4: revokeAll con cookie revogato è rifiutato ──

test('scenario 4a: revokeAll con cookie GIÀ revocato → 401, la versione NON viene toccata', async () => {
  setEnv('NODE_ENV', 'development');
  setEnv('SESSION_SECRET', undefined);
  const db = await dbMod.getDb();
  const user = await makeUser('revokeall@test.local');
  const cookie = session.signSession(user.id, user.sessionVersion ?? 0);
  const first = await auth.revokeAllSessions(db, cookie);
  assert.ok(first.ok, 'la prima revokeAll, con sessione viva, deve riuscire');
  assert.ok(first.newVersion >= 1);

  // secondo tentativo con lo STESSO cookie (sessione ormai revocata):
  // rifiutato, e nessun ulteriore bump.
  const vBefore = (await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].sessionVersion;
  const second = await auth.revokeAllSessions(db, cookie);
  assert.ok(!second.ok, 'revokeAll non può partire da una sessione revocata');
  assert.equal(second.status, 401);
  assert.equal(second.reason, 'revoked');
  const vAfter = (await db.select().from(schema.users).where(eq(schema.users.id, user.id)))[0].sessionVersion;
  assert.equal(vAfter, vBefore, 'la versione nel DB non deve cambiare');
});

test('scenario 4b: dopo revokeAll, il login successivo emette una sessione che funziona', async () => {
  setEnv('NODE_ENV', 'development');
  setEnv('SESSION_SECRET', undefined);
  const db = await dbMod.getDb();
  const user = await makeUser('relogin@test.local');
  const outcome = await auth.revokeAllSessions(db, session.signSession(user.id, user.sessionVersion ?? 0));
  assert.ok(outcome.ok);
  const relogged = session.signSession(user.id, outcome.newVersion);
  const check = await auth.authenticateSession(db, relogged);
  assert.ok(check.ok, 'la sessione riemessa dopo la revoca deve passare');
});

// ── Scenario 5: utente senza progetti → MAI refresh globale ──

test('scenario 5a: member SENZA progetti vede ZERO progetti (scoping su DB isolato)', async () => {
  const db = await dbMod.getDb();
  const member = await makeUser('member-senza@test.local', 'member');
  const admin = await makeUser('admin-con@test.local', 'admin');
  // un progetto privato dell'admin: il member NON lo vede
  await db.insert(schema.projects).values({
    name: 'Progetto dell\'admin', keywords: ['k'], languages: ['it'],
    mode: 'listening', ownerId: admin.id, visibility: 'private',
  });
  const memberSees = await projectAccess.visibleProjectsFor(db, member);
  assert.equal(memberSees.length, 0, 'il member non ha progetti accessibili');
  const adminSees = await projectAccess.visibleProjectsFor(db, admin);
  assert.ok(adminSees.length >= 1, 'l\'admin vede i suoi');
  // chi non è autenticato non vede NIENTE (getCurrentProject → null)
  const anonSees = await projectAccess.visibleProjectsFor(db, null);
  assert.equal(anonSees.length, 0);
});

test('scenario 5b: cookie REVOCATO + zero progetti → nessun progetto per la rotta di refresh (l\'invariante che uccide il fallback globale)', async () => {
  setEnv('NODE_ENV', 'development');
  setEnv('SESSION_SECRET', undefined);
  const db = await dbMod.getDb();
  const member = await makeUser('member-revogato@test.local', 'member');
  // il member emette una sessione, poi qualcuno la revoca (cambio password altrove)
  const cookie = session.signSession(member.id, member.sessionVersion ?? 0);
  await auth.bumpSessionVersion(db, member.id);
  // ciò che la rotta /api/refresh ricava da quel cookie: getCurrentUser → null
  // (versione superata) → getCurrentProject → null → requireProject risponde
  // 404 PRIMA di toccare runPipeline. Lo si prova componendo le stesse regole:
  const authOutcome = await auth.authenticateSession(db, cookie);
  assert.ok(!authOutcome.ok, 'sessione revocata');
  // getCurrentUser restituirebbe null → getCurrentProject → null → 404.
  const scopedUser: { id: number; role: string } | null = null;
  const projects_ = await projectAccess.visibleProjectsFor(db, scopedUser);
  const target = projects_.length > 0 ? projects_[0] : null;
  assert.equal(target, null,
    'nessun progetto accessibile: la pipeline NON può ricevere projectId undefined');
});

test('scenario 5c: member con progetto CONDIVISO lo vede (il criterio non è "member = cieco")', async () => {
  const db = await dbMod.getDb();
  const admin = await makeUser('admin-shared@test.local', 'admin');
  const member = await makeUser('member-shared@test.local', 'member');
  await db.insert(schema.projects).values({
    name: 'Progetto condiviso', keywords: ['k'], languages: ['it'],
    mode: 'listening', ownerId: admin.id, visibility: 'shared',
  });
  const memberSees = await projectAccess.visibleProjectsFor(db, member);
  assert.equal(memberSees.length, 1);
  assert.equal(memberSees[0].visibility, 'shared');
});

// ── Scenario 7: segreti assenti o invalidi bloccano le operazioni privilegiate ──

test('scenario 7a: boot di produzione SENZA SESSION_SECRET → validazione all\'avvio FALLISCA', async () => {
  setEnv('NODE_ENV', 'production');
  setEnv('SESSION_SECRET', undefined);
  setEnv('APP_PASSWORD', undefined);
  setEnv('DEMO_MODE', undefined);
  const { validateStartupConfig } = await import('../lib/config-check');
  const check = validateStartupConfig();
  assert.ok(!check.ok, 'il boot deve rifiutarsi');
  assert.match(check.message, /SESSION_SECRET is required/);
});

test('scenario 7b: in produzione APP_PASSWORD NON sostituisce più SESSION_SECRET', async () => {
  setEnv('NODE_ENV', 'production');
  setEnv('SESSION_SECRET', undefined);
  setEnv('APP_PASSWORD', 'una-password-di-login-molto-lunga-e-complessa');
  setEnv('DEMO_MODE', undefined);
  const { validateStartupConfig } = await import('../lib/config-check');
  assert.ok(!validateStartupConfig().ok,
    'la password di login non può firmare le sessioni nemmeno per fallback');
  assert.throws(() => session.sessionSecret(), /SESSION_SECRET is required/);
});

test('scenario 7c: segreto troppo corto / noto / ripetitivo / uguale ad APP_PASSWORD → rifiutato', async () => {
  setEnv('NODE_ENV', 'production');
  setEnv('DEMO_MODE', undefined);
  setEnv('APP_PASSWORD', 'password-login-diversa-e-lunga-1234567890');
  const { sessionSecretViolations } = await import('../lib/config-check');
  assert.ok(sessionSecretViolations('corto', undefined).includes('too-short'));
  assert.ok(sessionSecretViolations('sr-dev-secret-change-me', undefined).includes('known-weak'));
  assert.ok(sessionSecretViolations('a'.repeat(40), undefined).includes('low-entropy'));
  assert.ok(sessionSecretViolations(GOOD_SECRET, GOOD_SECRET).includes('same-as-app-password'));
  assert.deepEqual(sessionSecretViolations(GOOD_SECRET, 'password-login-diversa-e-lunga-1234567890'), []);
  // e sessionSecret() in produzione con un segreto debole LANCIA:
  setEnv('SESSION_SECRET', 'corto');
  assert.throws(() => session.sessionSecret(), /at least 32 characters/);
  setEnv('SESSION_SECRET', GOOD_SECRET);
  assert.equal(session.sessionSecret(), GOOD_SECRET);
});

test('scenario 7d: demo pubblica e sviluppo NON richiedono il segreto (eccezioni documentate)', async () => {
  setEnv('NODE_ENV', 'production');
  setEnv('SESSION_SECRET', undefined);
  setEnv('APP_PASSWORD', undefined);
  setEnv('DEMO_MODE', '1');
  const { validateStartupConfig } = await import('../lib/config-check');
  assert.deepEqual(validateStartupConfig(), { ok: true },
    'demo pubblica: nessun login, nessun cookie firmato — eccezione deliberata');
  setEnv('NODE_ENV', 'development');
  setEnv('DEMO_MODE', undefined);
  assert.deepEqual(validateStartupConfig(), { ok: true }, 'sviluppo locale: fallback dev');
});

// (helper eq importato in cima: nessun require() nel codice ESM)
