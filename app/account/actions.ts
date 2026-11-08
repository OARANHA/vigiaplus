'use server';

import { getActionUser } from '@/lib/action-auth';

import { cookies } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';

import { hashPassword, verifyPasswordHash } from '@/lib/password';
import { SESSION_COOKIE, signSession } from '@/lib/session';

export async function changePassword(_prev: unknown, formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  const user = await getActionUser();
  if (!user) return { error: 'session expired' };

  const current = String(formData.get('current') ?? '').trim();
  const next = String(formData.get('next') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!verifyPasswordHash(current, user.passwordHash)) {
    return { error: 'The current password is incorrect.' };
  }
  if (next.length < 8) return { error: 'The new password must be at least 8 characters.' };
  if (next !== confirm) return { error: 'The two passwords do not match.' };

  const db = await getDb();
  // Incremento 2 — hardening: il cambio password revoca OGNI sessione attiva
  // (altre sedi, altri dispositivi) incrementando users.session_version, e
  // riemette il cookie di QUESTA sede con la nuova versione.
  const [bumped] = await db.update(users)
    .set({
      passwordHash: hashPassword(next),
      mustChangePassword: 0,
      sessionVersion: sql`${users.sessionVersion} + 1`,
    })
    .where(eq(users.id, user.id))
    .returning({ sessionVersion: users.sessionVersion });

  const newVersion = bumped?.sessionVersion ?? (user.sessionVersion ?? 0) + 1;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, signSession(user.id, newVersion), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 86400,
    path: '/',
  });
  return { ok: true };
}
