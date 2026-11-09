import { redirect } from 'next/navigation';
import { Activity, ShieldCheck, Radio, Sparkles } from 'lucide-react';
import { getLocale } from '@/lib/i18n';
import { getCurrentUser } from '@/lib/auth';
import { LoginForm } from '@/components/login-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Entrar | VigiaPlus' };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user && process.env.DEMO_MODE !== '1') {
    redirect(user.globalRole === 'owner' ? '/console' : user.globalRole === 'analyst' ? '/' : '/portal');
  }
  const locale = await getLocale();
  return (
    <div className="va-auth" role="main">
      <section className="va-story" aria-label="Apresentação VigiaPlus">
        <div className="va-story-ambient va-orbit-one" aria-hidden="true" />
        <div className="va-story-ambient va-orbit-two" aria-hidden="true" />
        <div className="va-story-top">
          <span className="va-story-mark"><Radio size={20}/></span>
          <strong>VigiaPlus</strong>
          <span className="va-story-tag">INTELIGÊNCIA DE REPUTAÇÃO</span>
        </div>
        <div className="va-story-content">
          <span className="va-eyebrow"><Sparkles size={15}/> INTELIGÊNCIA QUE ANTECIPA</span>
          <h2>O que importa para sua reputação, <em>sob seus olhos.</em></h2>
          <p>Transforme publicações, menções e sinais digitais em informações organizadas para decisões melhores.</p>
          <div className="va-story-features">
            <span><Radio size={18}/> Monitoramento de fontes</span>
            <span><Activity size={18}/> Evidências e indicadores</span>
            <span><ShieldCheck size={18}/> Acesso por cliente</span>
          </div>
        </div>
        <div className="va-story-bottom"><span className="va-live-dot"/> VigiaPlus · Informação com contexto</div>
      </section>
      <section className="va-login-side" aria-label="Autenticação">
        <LoginForm locale={locale}/>
        <div className="va-login-bottom">© {new Date().getFullYear()} VigiaPlus · Ambiente de acesso restrito</div>
      </section>
    </div>
  );
}
