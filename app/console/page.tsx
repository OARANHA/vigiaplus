import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { ConsoleOwnerDashboard } from '@/components/console-owner-dashboard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Console do proprietário — VigiaPlus' };

export default async function ConsolePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.globalRole !== 'owner') notFound();
  return <ConsoleOwnerDashboard />;
}
