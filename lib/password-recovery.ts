/**
 * Recuperação de senha separada da sessão: prova de posse do e-mail, token
 * aleatório de uso único e expiração curta. Nenhuma senha ou token em logs.
 * Referência: OWASP Forgot Password Cheat Sheet.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { users, passwordResetTokens, auditEvents } from '@/lib/db/schema';
import { hashPassword } from '@/lib/password';
import { sessionSecret } from '@/lib/session';
import { AppError } from '@/lib/tenant/errors';

export const RESET_TTL_MINUTES = 30;
export const RESET_COOLDOWN_MINUTES = 10;

export function normalizeRecoveryEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length >= 6 && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function passwordResetHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isValidRecoveryToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
}

export function passwordForRecovery(value: unknown): string {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128)
    throw AppError.badRequest('A senha deve ter de 12 a 128 caracteres');
  return value;
}

/** Apenas um pedido a cada 10 min por e-mail normalizado, inclusive inexistente. */
async function reserveResetWindow(db: DB, email: string): Promise<boolean> {
  const keyHash = createHmac('sha256', sessionSecret())
    .update('password-reset-account:' + email).digest('hex');
  const result = await db.execute(sql`
    INSERT INTO password_reset_rate_limits(key_hash, next_allowed_at, updated_at)
    VALUES(${keyHash}, now() + INTERVAL '10 minutes', now())
    ON CONFLICT (key_hash) DO UPDATE
      SET next_allowed_at=EXCLUDED.next_allowed_at, updated_at=now()
    WHERE password_reset_rate_limits.next_allowed_at <= now()
    RETURNING key_hash
  `);
  return result.rows.length === 1;
}

export async function issuePasswordReset(db: DB, rawEmail: unknown): Promise<{
  token: string;
  email: string;
  tokenId: number;
} | null> {
  const email = normalizeRecoveryEmail(rawEmail);
  if (!email || !(await reserveResetWindow(db, email))) return null;
  const [user] = await db.select({id:users.id,email:users.email})
    .from(users).where(eq(users.email,email)).limit(1);
  if (!user) return null;
  const token = randomBytes(32).toString('base64url');
  const hash = passwordResetHash(token);
  // Revogar todos os pedidos anteriores antes de emitir outro.
  const issued = await db.execute(sql`
    WITH revoked AS (
      UPDATE password_reset_tokens SET revoked_at=now()
      WHERE user_id=${user.id} AND used_at IS NULL AND revoked_at IS NULL
      RETURNING id
    ), created AS (
      INSERT INTO password_reset_tokens(user_id,token_hash,expires_at)
      VALUES(${user.id},${hash},now()+INTERVAL '30 minutes')
      RETURNING id
    )
    SELECT id FROM created
  `);
  const row = issued.rows[0] as {id:number}|undefined;
  if (!row) throw new AppError('RESET_WRITE_FAILED',500,'Recuperação indisponível');
  await db.insert(auditEvents).values({
    actor:'recuperacao', action:'PASSWORD_RESET_REQUESTED',
    target:'user:'+user.id, reason:'Solicitação de redefinição recebida',
  });
  return {email:user.email,token,tokenId:Number(row.id)};
}

export async function revokePasswordReset(db: DB, tokenId: number): Promise<void> {
  await db.update(passwordResetTokens).set({revokedAt:new Date()})
    .where(eq(passwordResetTokens.id,tokenId));
}

export async function consumePasswordReset(
  db: DB, token: unknown, rawPassword: unknown,
): Promise<{userId: number; sessionVersion: number}> {
  if (!isValidRecoveryToken(token))
    throw AppError.badRequest('Link de recuperação inválido');
  const password = passwordForRecovery(rawPassword);
  // Calcular hash mesmo quando token incorreto; nenhuma sessão é emitida.
  const hashedPassword = hashPassword(password);
  const tokenHash = passwordResetHash(token);
  const changed = await db.execute(sql`
    WITH claimed AS (
      UPDATE password_reset_tokens p SET used_at=now()
      WHERE p.token_hash=${tokenHash}
        AND p.used_at IS NULL AND p.revoked_at IS NULL
        AND p.expires_at > now()
      RETURNING p.user_id
    ), updated AS (
      UPDATE users u SET
        password_hash=${hashedPassword}, must_change_password=0,
        session_version=u.session_version+1
      FROM claimed WHERE u.id=claimed.user_id
      RETURNING u.id, u.session_version
    ), recorded AS (
      INSERT INTO audit_events(actor,action,target,reason)
      SELECT 'recuperacao','PASSWORD_RESET_COMPLETED',
        'user:'||id::text,'Senha redefinida; sessões anteriores revogadas'
      FROM updated RETURNING id
    )
    SELECT updated.id,updated.session_version
    FROM updated INNER JOIN recorded ON true
  `);
  const row = changed.rows[0] as {id:number;session_version:number}|undefined;
  if (!row) throw new AppError('RESET_TOKEN_INVALID',409,
    'Link de recuperação expirado ou já utilizado');
  return {userId:Number(row.id),sessionVersion:Number(row.session_version)};
}
