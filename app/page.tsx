import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

// Root redirector: roteia o usuario para a superficie correta conforme seu role.
// - owner  -> /console (console do dono)
// - analyst-> /dashboard (64 paginas preservadas do crises)
// - client -> /portal (portal do cliente)
// - sem sessao -> /login
export default async function RootRedirector() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
    return;
  }
  if (user.globalRole === 'owner' || user.globalRole === 'admin') {
    redirect('/console');
  } else if (user.globalRole === 'analyst') {
    redirect('/dashboard');
  } else {
    redirect('/portal');
  }
}
