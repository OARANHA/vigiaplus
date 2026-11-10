import { ShieldCheck, Radio } from 'lucide-react';
import { AcceptInviteForm } from './accept-invite-form';
export const metadata={
  title:'Ativação da conta | VigiaPlus',referrer:'no-referrer',
  robots:{index:false,follow:false},
};
export const dynamic='force-dynamic';
export default async function InvitationPage({searchParams}:{
  searchParams:Promise<{token?:string}>,
}){
  const {token}=await searchParams;
  return <main className="va-auth">
    <section className="va-story" aria-label="VigiaPlus">
      <div className="va-story-top"><span className="va-story-mark"><Radio size={20}/></span>
        <strong>VigiaPlus</strong><span className="va-story-tag">INTELIGÊNCIA DE REPUTAÇÃO</span>
      </div>
      <div className="va-story-content">
        <span className="va-eyebrow"><ShieldCheck size={16}/> ACESSO PROTEGIDO</span>
        <h2>A informação certa, <em>para as pessoas certas.</em></h2>
        <p>Seu acesso é individual e vinculado à organização que convidou você.</p>
        <div className="va-story-features">
          <span>Convite de uso único</span><span>Senha pessoal</span><span>Dados segregados por cliente</span>
        </div>
      </div>
      <div className="va-story-bottom">VigiaPlus · Acesso restrito</div>
    </section>
    <AcceptInviteForm token={typeof token==='string'?token:''}/>
  </main>;
}
