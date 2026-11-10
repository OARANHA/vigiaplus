import { sql } from 'drizzle-orm';
import type { DB } from '@/lib/db';
import { AppError } from '@/lib/tenant/errors';

const INDEX = 'vpx_membership_tenant_user_unique';

/** Migração aditiva: mantém dados legados intactos diante de duplicidades. */
export async function ensureMembershipUniqueness(db: DB): Promise<boolean> {
  const result = await db.execute(sql`SELECT count(*)::integer AS duplicate_groups
    FROM (
      SELECT tenant_id, user_id FROM memberships
      GROUP BY tenant_id, user_id HAVING count(*) > 1
    ) duplicates`);
  const duplicateGroups = Number((result.rows[0] as { duplicate_groups:number })?.duplicate_groups ?? 0);
  if (duplicateGroups > 0) {
    console.warn('VigiaPlus: memberships duplicadas. Aceite de convites suspenso até revisão.');
    return false;
  }
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS vpx_membership_tenant_user_unique
    ON memberships (tenant_id, user_id)`);
  return true;
}

export async function requireMembershipUniqueness(db: DB): Promise<void> {
  const result = await db.execute(sql`SELECT to_regclass('public.vpx_membership_tenant_user_unique') IS NOT NULL AS ready`);
  if ((result.rows[0] as {ready:boolean}|undefined)?.ready !== true) {
    throw new AppError('MEMBERSHIP_CONSTRAINT_PENDING',409,
      'Vínculos duplicados exigem conciliação antes de ativar convites');
  }
}
