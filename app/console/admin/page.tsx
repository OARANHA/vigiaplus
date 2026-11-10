import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { OwnerAdminWorkspace } from '@/components/owner-admin-workspace';
import './owner-admin.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Administração da plataforma — VigiaPlus' };

export default async function AdministrationPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.globalRole !== 'owner') notFound();
  return <OwnerAdminWorkspace />;
}
