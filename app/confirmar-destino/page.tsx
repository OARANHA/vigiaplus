import { Radio,ShieldCheck } from 'lucide-react';
import { VerifyDestination } from './verify-destination';
export const metadata={
 title:'Confirmar destinatário | VigiaPlus',
 referrer:'no-referrer',
 robots:{index:false,follow:false},
};
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{
 searchParams:Promise<{token?:string}>
}){
 const {token}=await searchParams;
 return <main className="va-auth">
  <section className="va-story" aria-label="VigiaPlus">
   <div className="va-story-top"><span className="va-story-mark"><Radio size={20}/></span><strong>VigiaPlus</strong></div>
   <div className="va-story-content">
    <span className="va-eyebrow"><ShieldCheck size={16}/> PROVA DE POSSE</span>
    <h2>Alertas somente para <em>quem autoriza.</em></h2>
    <p>Este link é temporário e de uso único. Nenhum envio de monitoramento será habilitado sem sua confirmação.</p>
   </div>
   <div className="va-story-bottom">VigiaPlus · Segurança das notificações</div>
  </section>
  <VerifyDestination token={typeof token==='string'?token:''}/>
 </main>;
}