import { LockKeyhole, Radio } from 'lucide-react';
import { ConfirmResetForm } from './confirm-reset-form';
export const metadata={title:'Nova senha | VigiaPlus',
  robots:{index:false,follow:false},referrer:'no-referrer'};
export const dynamic='force-dynamic';
export default async function ResetPasswordPage({searchParams}:{
  searchParams:Promise<{token?:string}>
}){
  const {token}=await searchParams;
  return <main className="va-auth">
    <section className="va-story" aria-label="Recuperação de senha">
      <div className="va-story-top"><span className="va-story-mark"><Radio size={20}/></span>
        <strong>VigiaPlus</strong><span className="va-story-tag">IDENTIDADE PROTEGIDA</span></div>
      <div className="va-story-content"><span className="va-eyebrow">
          <LockKeyhole size={15}/> VERIFICAÇÃO DE ACESSO</span>
        <h2>Uma nova senha. <em>Mais controle.</em></h2>
        <p>Seu link de recuperação expira após 30 minutos e não pode ser reutilizado.</p>
        <div className="va-story-features">
          <span>Token de uso único</span><span>Sessões anteriores revogadas</span>
        </div>
      </div><div className="va-story-bottom">VigiaPlus · Área segura</div>
    </section>
    <ConfirmResetForm token={typeof token==='string'?token:''}/>
  </main>;
}
