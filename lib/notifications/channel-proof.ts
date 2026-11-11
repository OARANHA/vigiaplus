/**
 * ALT-05 — Prova de posse de e-mail para destinatários de alertas.
 * NUNCA confiar em PATCH verified=true nem em flags legadas importadas.
 */
import { createHash, randomBytes } from 'node:crypto';
import { eq, sql, and } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { notificationChannels, notificationChannelProofs } from '@/lib/db/schema';
import { AppError } from '@/lib/tenant/errors';

export const CHANNEL_PROOF_TTL_MINUTES = 30;
export const CHANNEL_PROOF_COOLDOWN_MINUTES = 10;

export function emailForVerification(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return v.length >= 6 && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
    ? v : null;
}
export function isChannelProofToken(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
}
export function channelProofHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueChannelProof(db: DB, tenantId: number, channelId: number): Promise<{
  token: string; tokenHash: string; destination: string;
}> {
  if (![tenantId,channelId].every(x=>Number.isSafeInteger(x)&&x>0))
    throw AppError.badRequest('Organização ou destinatário inválido');
  const [channel] = await db.select().from(notificationChannels).where(and(
    eq(notificationChannels.id,channelId),eq(notificationChannels.tenantId,tenantId),
  )).limit(1);
  if (!channel) throw AppError.notFound('Destinatário não encontrado');
  if (channel.channel !== 'email')
    throw AppError.badRequest('Este método de verificação é exclusivo para e-mail');
  if (channel.verifiedAt)
    throw new AppError('ALREADY_VERIFIED',409,'E-mail já comprovado; desative para suspender o envio');
  const destination = emailForVerification(channel.destination);
  if (!destination) throw AppError.badRequest('Endereço de e-mail inválido');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = channelProofHash(token);
  const issued=await db.execute(sql`
    INSERT INTO notification_channel_proofs(
      tenant_id,channel_id,destination,token_hash,requested_at,expires_at,used_at,revoked_at
    )
    VALUES(${tenantId},${channelId},${channel.destination},${tokenHash},
      now(),now()+INTERVAL '30 minutes',NULL,NULL)
    ON CONFLICT (channel_id) DO UPDATE SET
      token_hash=EXCLUDED.token_hash,
      destination=EXCLUDED.destination,
      requested_at=now(),
      expires_at=EXCLUDED.expires_at,
      used_at=NULL,
      revoked_at=NULL
    WHERE notification_channel_proofs.requested_at <= now() - INTERVAL '10 minutes'
    RETURNING id
  `);
  if(issued.rows.length!==1)throw new AppError('PROOF_RATE_LIMITED',429,
    'Aguarde dez minutos antes de solicitar outro link');
  return {token,tokenHash,destination};
}

export async function revokeChannelProof(db: DB, tokenHash: string): Promise<void> {
  await db.update(notificationChannelProofs).set({revokedAt:new Date()}).where(and(
    eq(notificationChannelProofs.tokenHash,tokenHash),
    sql`${notificationChannelProofs.usedAt} IS NULL`,
  ));
}

/** Uso único, prova e trilha de auditoria em uma ÚNICA instrução SQL atômica. */
export async function consumeChannelProof(db: DB, rawToken: unknown): Promise<number> {
  if(!isChannelProofToken(rawToken))throw AppError.badRequest('Token de confirmação inválido');
  const tokenHash=channelProofHash(rawToken);
  const updated=await db.execute(sql`
    WITH consumed AS (
      UPDATE notification_channel_proofs p SET used_at=now()
      FROM notification_channels c
      WHERE p.token_hash=${tokenHash} AND p.used_at IS NULL AND p.revoked_at IS NULL
        AND p.expires_at>now()
        AND c.id=p.channel_id AND c.tenant_id=p.tenant_id
        AND c.channel='email' AND c.destination=p.destination
      RETURNING p.channel_id,p.tenant_id,p.destination
    ), activated AS (
      UPDATE notification_channels c SET verified=1,verified_at=now()
      FROM consumed
      WHERE c.id=consumed.channel_id AND c.tenant_id=consumed.tenant_id
        AND c.destination=consumed.destination
      RETURNING c.id,c.tenant_id
    ), recorded AS (
      INSERT INTO audit_events(actor,tenant_id,action,target,reason)
      SELECT 'prova-email',tenant_id,'NOTIFICATION_CHANNEL_VERIFIED',
        'notification_channel:'||id::text,'Posse do e-mail confirmada por token de uso único'
      FROM activated RETURNING id
    )
    SELECT activated.id FROM activated INNER JOIN recorded ON true
  `);
  const row=updated.rows[0] as {id:number}|undefined;
  if(!row) throw new AppError('PROOF_INVALID',409,'Link expirado, revogado ou já utilizado');
  return Number(row.id);
}

/** Verificações antigas (boolean) não dão autorização para o worker enviar. */
export function channelHasProof(row:{
  verified: number | null; verifiedAt: Date | null;
}):boolean {
  return row.verified===1 && row.verifiedAt instanceof Date && !Number.isNaN(row.verifiedAt.getTime());
}
