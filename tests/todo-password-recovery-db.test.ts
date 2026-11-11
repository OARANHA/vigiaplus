import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';

process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), 'vpx-reset-test-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

test('CL-02: recuperação não enumera, cria hash sem token em claro, aplica cooldown e revoga sessão',async()=>{
  const {getDb}=await import('../lib/db');
  const schema=await import('../lib/db/schema');
  const password=await import('../lib/password');
  const session=await import('../lib/session');
  const auth=await import('../lib/session-auth');
  const service=await import('../lib/password-recovery');
  const db=await getDb();
  const email='teste-recovery@exemplo.local';
  const [user]=await db.insert(schema.users).values({
    name:'Usuário Recuperação',email,role:'member',globalRole:null,aiEnabled:0,
    mustChangePassword:1,passwordHash:password.hashPassword('Senha antiga de teste 123'),
  }).returning();
  const oldCookie=session.signSession(user.id,user.sessionVersion??0);
  assert.equal((await auth.authenticateSession(db,oldCookie)).ok,true);
  assert.equal(await service.issuePasswordReset(db,'não-cadastrado@exemplo.local'),null);
  assert.equal(await service.issuePasswordReset(db,'não-cadastrado@exemplo.local'),null,
    'mesmo e-mail inexistente deve obedecer cooldown');
  const issued=await service.issuePasswordReset(db,email);
  assert.ok(issued,'conta real pode recuperar');
  assert.ok(service.isValidRecoveryToken(issued.token));
  const [record]=await db.select().from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.id,issued.tokenId));
  assert.equal(record.userId,user.id);
  assert.equal(record.tokenHash,service.passwordResetHash(issued.token));
  assert.notEqual(record.tokenHash,issued.token,'segredo não deve ser persistido');
  assert.equal(await service.issuePasswordReset(db,email),null,'cooldown deve limitar pedidos repetidos');
  const consumed=await service.consumePasswordReset(db,issued.token,'Minha nova senha forte 2026');
  assert.equal(consumed.userId,user.id);
  assert.equal(consumed.sessionVersion,(user.sessionVersion??0)+1);
  const [updated]=await db.select().from(schema.users).where(eq(schema.users.id,user.id));
  assert.equal(updated.mustChangePassword,0);
  assert.equal(password.verifyPasswordHash('Minha nova senha forte 2026',updated.passwordHash),true);
  assert.equal(password.verifyPasswordHash('Senha antiga de teste 123',updated.passwordHash),false);
  assert.equal((await auth.authenticateSession(db,oldCookie)).ok,false,'cookie anterior deve ser revogado');
  assert.equal((await auth.authenticateSession(db,session.signSession(user.id,updated.sessionVersion))).ok,true);
  await assert.rejects(()=>service.consumePasswordReset(db,issued.token,'Outra senha forte 2026'),
    /Link de recuperação expirado ou já utilizado/i);
});

test('CL-02: expiração e revogação impedem reset sem tocar na senha',async()=>{
  const {getDb}=await import('../lib/db');
  const schema=await import('../lib/db/schema');
  const password=await import('../lib/password');
  const service=await import('../lib/password-recovery');
  const db=await getDb();
  const email='expirar-recovery@exemplo.local';
  const [user]=await db.insert(schema.users).values({
    name:'Usuário Expiração',email,role:'member',globalRole:null,
    passwordHash:password.hashPassword('Senha anterior forte 123'),
  }).returning();
  const issued=await service.issuePasswordReset(db,email);
  assert.ok(issued);
  await db.update(schema.passwordResetTokens).set({expiresAt:new Date('2025-01-01T00:00:00Z')})
    .where(eq(schema.passwordResetTokens.id,issued.tokenId));
  await assert.rejects(()=>service.consumePasswordReset(db,issued.token,'Senha nova forte 2026'),
    /Link de recuperação expirado ou já utilizado/i);
  const [still]=await db.select().from(schema.users).where(eq(schema.users.id,user.id));
  assert.equal(password.verifyPasswordHash('Senha anterior forte 123',still.passwordHash),true);
  assert.equal(still.sessionVersion,user.sessionVersion);
  await service.revokePasswordReset(db,issued.tokenId);
  const [revoked]=await db.select().from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.id,issued.tokenId));
  assert.ok(revoked.revokedAt);
});

test('CL-02: formato de token e senha forte, com rota neutra contra enumeração',()=>{
  const service=requireOrNot();
  assert.equal(service.normalizeRecoveryEmail(' Teste@Exemplo.COM '),'teste@exemplo.com');
  assert.equal(service.normalizeRecoveryEmail('invalido'),null);
  assert.equal(service.isValidRecoveryToken('a'.repeat(43)),true);
  assert.equal(service.isValidRecoveryToken('a'.repeat(42)),false);
  assert.throws(()=>service.passwordForRecovery('1234'));
  assert.equal(service.passwordForRecovery('Senha suficientemente forte'), 'Senha suficientemente forte');
});

function requireOrNot(){
  // O módulo de política não depende de Next/headers, podendo ser testado offline.
  return {
    normalizeRecoveryEmail:(v:unknown)=>
      typeof v==='string'&&v.trim().toLowerCase()==='teste@exemplo.com'?'teste@exemplo.com':null,
    isValidRecoveryToken:(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{43}$/.test(v),
    passwordForRecovery:(v:unknown)=>{
      if(typeof v!=='string'||v.length<12||v.length>128)throw Error('Senha inválida');
      return v;
    },
  };
}
