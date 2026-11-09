import { redirect } from 'next/navigation';
import { desc, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, projects } from '@/lib/db/schema';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { getT } from '@/lib/i18n';
import { TeamManager } from '@/components/team-manager';

export const metadata = { title: 'Equipe' };

export default async function TeamPage() {
  const t = await getT();
  const me = await getCurrentUser();
  if (!isAdmin(me)) redirect('/impostazioni/account');
  const db = await getDb();

  const rows = await db.select({
    id: users.id, name: users.name, email: users.email, role: users.role,
    aiEnabled: users.aiEnabled, mustChangePassword: users.mustChangePassword,
  }).from(users).orderBy(desc(sql`${users.role} = 'admin'`), users.name);

  // Conteggio progetti per proprietario (query separata: la subquery correlata è ambigua)
  const counts = await db.select({ ownerId: projects.ownerId, n: sql<number>`count(*)` })
    .from(projects).groupBy(projects.ownerId);
  const countByOwner = new Map(counts.map((c) => [c.ownerId, Number(c.n)]));

  return (
    <>
      <PageHeader
        title={t('page.team.title', 'Equipe')}
        subtitle={t('h5.team.subtitle', 'Gerencie o acesso da equipe. Membros com IA suspensa podem coletar dados, mas precisam de autorização para consumir a API de IA.')}
      />
      <TeamManager users={rows.map((r) => ({ ...r, projectCount: countByOwner.get(r.id) ?? 0 }))} />
    </>
  );
}
