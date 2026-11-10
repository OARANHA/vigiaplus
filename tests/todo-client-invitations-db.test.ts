import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  invitationTokenHash, looksLikeInviteToken, inviteRole, inviteEmail, invitePassword,
} from '../lib/tenant/invitations';

process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), 'vpx-invite-'));
delete process.env.DATABASE_URL;
delete process.env.DEMO_MODE;

test('CL-01/02: convite real só cria conta e membership do tenant no aceite; token não fica em claro',async()=>{
  const {getDb}=await import('../lib/db');
  const schema=await import('../lib/db/schema');
  const svc=await import('../lib/tenant/invitations');
  const db=await getDb();
  const [alpha,beta]=await db.insert(schema.tenants).values([
    {name:'Cliente Alfa Convites',slug:'alfa-convites',status:'pending'},
    {name:'Cliente Beta Convites',slug:'beta-convites',status:'active'},
  ]).returning();
  const created=await svc.createClientInvitation(db,{
    tenantId:alpha.id,email:'pessoa@alfa.local',role:'client_admin',
    actor:'Dono de Teste',reason:'Acesso ao contrato do cliente Alfa',
  });
  assert.ok(looksLikeInviteToken(created.token));
  assert.notEqual(invitationTokenHash(created.token),created.token);
  const [stored]=await db.select().from(schema.invitations)
    .where(eq(schema.invitations.id,created.id));
  assert.equal(stored.tokenHash,invitationTokenHash(created.token));
  assert.equal((await db.select().from(schema.users)
    .where(eq(schema.users.email,'pessoa@alfa.local'))).length,0);

  const result=await svc.acceptClientInvitation(db,created.token,
    'Cliente de Teste','Senha longa e pessoal 2026');
  const [account]=await db.select().from(schema.users)
    .where(eq(schema.users.id,result.userId));
  assert.equal(account.email,'pessoa@alfa.local');
  assert.equal(account.globalRole,null);
  assert.equal(account.mustChangePassword,0);
  const membership=await db.select().from(schema.memberships)
    .where(eq(schema.memberships.userId,result.userId));
  assert.equal(membership.length,1);
  assert.equal(membership[0].tenantId,alpha.id);
  assert.equal(membership[0].role,'client_admin');
  assert.notEqual(membership[0].tenantId,beta.id);
  assert.equal((await db.select().from(schema.auditEvents)
    .where(eq(schema.auditEvents.tenantId,alpha.id))).length,2);
  await assert.rejects(()=>svc.acceptClientInvitation(db,created.token,
    'Outra Pessoa','Senha longa e pessoal 2026'),/Convite inválido|não cadastrado|usado/i);

  await assert.rejects(()=>svc.createClientInvitation(db,{
    tenantId:beta.id,email:'pessoa@alfa.local',role:'client_viewer',
    actor:'Dono de Teste',reason:'Não associar conta existente',
  }),/e-mail já possui conta/i);
});

test('CL-02: convite revogado não cria usuário ou vínculo; convite ativo não permite duplicar',async()=>{
  const {getDb}=await import('../lib/db');
  const schema=await import('../lib/db/schema');
  const svc=await import('../lib/tenant/invitations');
  const db=await getDb();
  const [tenant]=await db.insert(schema.tenants).values({
    name:'Cliente Gama Convites',slug:'gama-convites',status:'pending',
  }).returning();
  const input={tenantId:tenant.id,email:'teste@gama.local' as string,
    role:'client_viewer' as const,actor:'Dono de Teste',reason:'Convite inicial do cliente Gama'};
  const created=await svc.createClientInvitation(db,input);
  await assert.rejects(()=>svc.createClientInvitation(db,input),/Já existe convite ativo/i);
  const revoked=await svc.revokeClientInvitation(db,{
    tenantId:tenant.id,invitationId:created.id,actor:'Dono de Teste',
    reason:'Convite substituído antes do aceite',
  });
  assert.equal(revoked,true);
  assert.equal(await svc.revokeClientInvitation(db,{
    tenantId:tenant.id,invitationId:created.id,actor:'Dono de Teste',
    reason:'Tentativa de segunda revogação',
  }),false);
  await assert.rejects(()=>svc.acceptClientInvitation(db,created.token,
    'Outro Nome','Senha longa e pessoal 2026'),/Convite inválido|usado|revogado/i);
  assert.equal((await db.select().from(schema.users)
    .where(eq(schema.users.email,input.email))).length,0);
  const replacement=await svc.createClientInvitation(db,input);
  assert.notEqual(replacement.token,created.token);
});

test('convites validam papéis, e-mails, tokens e qualidade mínima da senha',()=>{
  assert.equal(inviteRole('client_admin'),'client_admin');
  assert.throws(()=>inviteRole('owner'));
  assert.equal(inviteEmail(' Test@EXEMPLO.COM '),'test@exemplo.com');
  assert.throws(()=>inviteEmail('invalido'));
  assert.throws(()=>invitePassword('abc123'));
  assert.equal(looksLikeInviteToken('abc'),false);
  assert.equal(looksLikeInviteToken('z'.repeat(43)),true);
});
