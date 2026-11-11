import { ShieldCheck, Radio } from 'lucide-react';
import { RequestResetForm } from './request-reset-form';
export const metadata={title:'Recuperar acesso | VigiaPlus',
  robots:{index:false,follow:false},referrer:'no-referrer'};
export default function RecoveryPage(){
  return <main className="va-auth">
    <section className="va-story" aria-label="Proteção VigiaPlus">
      <div className="va-story-top"><span className="va-story-mark"><Radio size={20}/></span>
        <strong>VigiaPlus</strong><span className="va-story-tag">ACESSO PROTEGIDO</span></div>
      <div className="va-story-content"><span className="va-eyebrow"><ShieldCheck size={15}/> SUA CONTA</span>
        <h2>Seu acesso, <em>sob seu controle.</em></h2>
        <p>Defina uma nova senha sem compartilhar suas credenciais com terceiros.</p>
        <div className="va-story-features">
          <span>Link temporário</span><span>Uso único</span><span>Proteção das sessões anteriores</span>
        </div>
      </div><div className="va-story-bottom">VigiaPlus · Segurança da conta</div>
    </section>
    <RequestResetForm/>
  </main>;
}
