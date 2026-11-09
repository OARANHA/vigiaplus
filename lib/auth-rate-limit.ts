/**
 * Rate limit de autenticação com contador atômico PostgreSQL/PGlite.
 * Nenhuma credencial, email ou IP é persistida em claro.
 * O IP só é considerado quando a aplicação confia em um proxy reverso.
 */
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { eq, gt, sql } from 'drizzle-orm';
import type { DB } from './db';
import { authLoginLimits } from './db/schema';
import { sessionSecret } from './session';

export const AUTH_WINDOW_MS = 15 * 60_000;
export const AUTH_ACCOUNT_MAX_FAILURES = 8;
export const AUTH_IP_MAX_FAILURES = 40;
export type LoginLimitKey = { hash: string; maxFailures: number };

function keyHash(namespace: string, value: string): string {
  return createHmac('sha256', sessionSecret()).update(namespace + ':' + value).digest('hex');
}

/** O último IP de X-Forwarded-For é o hop mais próximo do proxy de confiança. */
export function trustedClientIp(headers: Headers, trustProxy = process.env.AUTH_TRUST_PROXY === '1'): string | null {
  if (!trustProxy) return null;
  const forwarded = headers.get('x-forwarded-for');
  const ip = forwarded?.split(',').at(-1)?.trim() ?? '';
  return isIP(ip) ? ip : null;
}

export function loginLimitKeys(email: string, headers: Headers, trustProxy = process.env.AUTH_TRUST_PROXY === '1'): LoginLimitKey[] {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320) return [];
  const keys: LoginLimitKey[] = [
    { hash: keyHash('account', normalized), maxFailures: AUTH_ACCOUNT_MAX_FAILURES },
  ];
  const ip = trustedClientIp(headers, trustProxy);
  if (ip) keys.push({ hash: keyHash('ip', ip), maxFailures: AUTH_IP_MAX_FAILURES });
  return keys;
}

export async function loginBlockRemainingSeconds(db: DB, keys: LoginLimitKey[], now = new Date()): Promise<number> {
  let seconds = 0;
  for (const key of keys) {
    const [entry] = await db.select({ lockedUntil: authLoginLimits.lockedUntil })
      .from(authLoginLimits).where(eq(authLoginLimits.keyHash, key.hash)).limit(1);
    if (entry?.lockedUntil && entry.lockedUntil > now) {
      seconds = Math.max(seconds, Math.ceil((entry.lockedUntil.getTime() - now.getTime()) / 1000));
    }
  }
  return seconds;
}

/** UPSERT é atômico para a mesma identidade até em instâncias diferentes. */
export async function recordFailedLogin(db: DB, keys: LoginLimitKey[], now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - AUTH_WINDOW_MS).toISOString();
  const lockUntil = new Date(now.getTime() + AUTH_WINDOW_MS).toISOString();
  for (const key of keys) {
    const expired = sql`${authLoginLimits.windowStart} <= ${cutoff}::timestamptz`;
    await db.insert(authLoginLimits).values({
      keyHash: key.hash, failedCount: 1, windowStart: now,
      lockedUntil: key.maxFailures <= 1 ? new Date(lockUntil) : null, updatedAt: now,
    }).onConflictDoUpdate({
      target: authLoginLimits.keyHash,
      set: {
        failedCount: sql<number>`CASE WHEN ${expired} THEN 1 ELSE ${authLoginLimits.failedCount} + 1 END`,
        windowStart: sql`CASE WHEN ${expired} THEN ${now.toISOString()}::timestamptz ELSE ${authLoginLimits.windowStart} END`,
        lockedUntil: sql`CASE WHEN ${expired} THEN NULL
          WHEN ${authLoginLimits.failedCount} + 1 >= ${key.maxFailures}
            THEN ${lockUntil}::timestamptz ELSE NULL END`,
        updatedAt: now,
      },
    });
  }
}

export async function clearSuccessfulLogin(db: DB, email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320) return;
  await db.delete(authLoginLimits).where(eq(authLoginLimits.keyHash, keyHash('account', normalized)));
}

/** Permanecem válidas as falhas do IP, para impedir enumeração de identidades. */
export function loginTooManyResponseHeaders(seconds: number): HeadersInit {
  return { 'Retry-After': String(Math.max(1, Math.ceil(seconds))), 'Cache-Control': 'no-store' };
}
