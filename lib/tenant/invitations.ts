/**
 * Ciclo de vida de convites para clientes. Token aleatório de 256 bits,
 * persistido apenas como SHA-256. Não cria senha nem acesso antes do aceite.
 * Somente novas identidades: vincular conta já existente exige confirmação
 * autenticada em fluxo próprio (não habilitado neste lote).
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { invitations, tenants, users } from '@/lib/db/schema';
import { hashPassword } from '@/lib/password';
import { AppError } from '@/lib/tenant/errors';
import { requireMembershipUniqueness } from '@/lib/db/client-constraints';

export type InviteRole = 'client_admin' | 'client_viewer';
export function inviteRole(value: unknown): InviteRole {
  if (value === 'client_admin' || value === 'client_viewer') return value;
  throw AppError.badRequest('Perfil de convite inválido');
}
export function inviteEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length < 6 || email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw AppError.badRequest('Informe um endereço de e-mail válido');
  return email;
}
export function invitePassword(value: unknown): string {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 12 || password.length > 128)
    throw AppError.badRequest('A senha deve conter de 12 a 128 caracteres');
  return password;
}
export function invitationTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
export function looksLikeInviteToken(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
}
export type InviteCreated = { id: number; token: string; expiresAt: Date };

export async function createClientInvitation(
  db: DB, input: { tenantId: number; email: string; role: InviteRole; actor: string; reason: string },
): Promise<InviteCreated> {
  if (!Number.isSafeInteger(input.tenantId) || input.tenantId <= 0)
    throw AppError.badRequest('Organização inválida');
  if (input.reason.trim().length < 5 || input.reason.length > 300)
    throw AppError.badRequest('Informe a justificativa de convite (5 a 300 caracteres)');
  await requireMembershipUniqueness(db);
  const [tenant] = await db.select({id:tenants.id,status:tenants.status})
    .from(tenants).where(eq(tenants.id,input.tenantId)).limit(1);
  if (!tenant || (tenant.status !== 'pending' && tenant.status !== 'active'))
    throw AppError.forbidden('Convites permitidos somente para organizações pendentes ou ativas');
  const [existing] = await db.select({id:users.id}).from(users)
    .where(eq(users.email,input.email)).limit(1);
  if (existing) throw new AppError('USER_ALREADY_EXISTS',409,
    'O e-mail já possui conta. Vinculação de contas existentes requer fluxo autenticado');
  const [active] = await db.select({id:invitations.id}).from(invitations)
    .where(and(eq(invitations.tenantId,input.tenantId),eq(invitations.email,input.email),
      isNull(invitations.usedAt),isNull(invitations.revokedAt),gt(invitations.expiresAt,new Date()))).limit(1);
  if (active) throw new AppError('INVITE_ALREADY_PENDING',409,
    'Já existe convite ativo para este endereço. Revogue antes de gerar outro');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 48 * 3600_000);
  const result = await db.execute(sql`
    WITH created AS (
      INSERT INTO invitations(tenant_id,email,role,token_hash,expires_at)
      VALUES(${input.tenantId},${input.email},${input.role},
        ${invitationTokenHash(token)},${expiresAt})
      RETURNING id,tenant_id
    ),
    audit AS (
      INSERT INTO audit_events(actor,tenant_id,action,target,reason)
      SELECT ${input.actor},tenant_id,'INVITATION_CREATED',
        'invitation:'||id::text,${input.reason.trim()} FROM created
      RETURNING id
    )
    SELECT created.id FROM created CROSS JOIN audit
  `);
  const row = result.rows[0] as {id:number}|undefined;
  if (!row) throw new AppError('INVITE_WRITE_FAILED',409,'Convite não registrado');
  return { id: row.id, token, expiresAt };
}

export async function acceptClientInvitation(
  db: DB, token: string, name: string, password: string,
): Promise<{userId:number;tenantId:number}> {
  if (!looksLikeInviteToken(token)) throw AppError.badRequest('Convite inválido');
  if (name.trim().length < 2 || name.trim().length > 120)
    throw AppError.badRequest('Nome deve conter de 2 a 120 caracteres');
  invitePassword(password);
  await requireMembershipUniqueness(db);
  const hash = invitationTokenHash(token);
  const passwordHash = hashPassword(password);
  // A recuperação do token, criação da identidade, membership e auditoria
  // usam uma única instrução SQL no Neon HTTP/PGlite (sem transação interativa).
  const result = await db.execute(sql`
    WITH claim AS (
      UPDATE invitations i SET used_at=now()
      WHERE i.token_hash=${hash} AND i.used_at IS NULL
        AND i.revoked_at IS NULL AND i.expires_at>now()
        AND i.role IN ('client_admin','client_viewer')
        AND EXISTS (SELECT 1 FROM tenants t WHERE t.id=i.tenant_id
          AND t.status IN ('pending','active'))
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email=i.email)
      RETURNING i.tenant_id,i.email,i.role,i.id
    ), created_user AS (
      INSERT INTO users(name,email,password_hash,role,global_role,
        must_change_password,ai_enabled,session_version)
      SELECT ${name.trim()},email,${passwordHash},'member',NULL,0,0,0 FROM claim
      ON CONFLICT(email) DO NOTHING RETURNING id
    ), linked AS (
      INSERT INTO memberships(tenant_id,user_id,role)
      SELECT claim.tenant_id, created_user.id, claim.role
      FROM claim CROSS JOIN created_user
      ON CONFLICT(tenant_id,user_id) DO NOTHING
      RETURNING tenant_id,user_id
    ), audit AS (
      INSERT INTO audit_events(actor,tenant_id,action,target,reason)
      SELECT 'convite',tenant_id,'INVITATION_ACCEPTED',
        'user:'||user_id::text,'Primeiro acesso por convite' FROM linked
      RETURNING tenant_id
    )
    SELECT linked.user_id,linked.tenant_id FROM linked JOIN audit USING(tenant_id)
  `);
  const row = result.rows[0] as {user_id:number;tenant_id:number}|undefined;
  if (!row) throw new AppError('INVITE_NOT_AVAILABLE',409,
    'Convite inválido, vencido, usado, revogado ou e-mail já cadastrado');
  return { userId:Number(row.user_id),tenantId:Number(row.tenant_id) };
}

export async function revokeClientInvitation(
  db: DB, input: { tenantId:number; invitationId:number; actor:string; reason:string },
): Promise<boolean> {
  const result = await db.execute(sql`
    WITH cancelled AS (
      UPDATE invitations SET revoked_at=now()
      WHERE id=${input.invitationId} AND tenant_id=${input.tenantId}
        AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id,tenant_id
    ), audit AS (
      INSERT INTO audit_events(actor,tenant_id,action,target,reason)
      SELECT ${input.actor},tenant_id,'INVITATION_REVOKED',
        'invitation:'||id::text,${input.reason} FROM cancelled RETURNING id
    )
    SELECT cancelled.id FROM cancelled CROSS JOIN audit
  `);
  return result.rows.length === 1;
}
