import { eq } from 'drizzle-orm';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { isDemoMode } from '@/lib/session';
import { getCurrentProject } from '@/lib/data';
import { getDb } from '@/lib/db';
import { projects } from '@/lib/db/schema';

/** Server Actions are write operations, never synthetic demo users. */
export async function getActionUser() {
  return isDemoMode() ? null : getCurrentUser();
}

export async function canEditActionProject(projectId: number): Promise<boolean> {
  const user = await getActionUser();
  if (!user) return false;
  const [project] = await (await getDb()).select().from(projects).where(eq(projects.id, projectId));
  return Boolean(project && (isAdmin(user) || project.ownerId === user.id));
}

export async function getActionProject() {
  const user = await getActionUser();
  if (!user) return null;
  const project = await getCurrentProject();
  return project && (isAdmin(user) || project.ownerId === user.id) ? project : null;
}
