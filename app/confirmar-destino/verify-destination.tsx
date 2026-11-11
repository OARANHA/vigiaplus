'use client';
import { useState } from 'react';
import Link from 'next/link';
export function VerifyDestination({token}:{token:string}){
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [done,setDone]=useState(false);
 async function confirm(){
  setBusy(true);setError('');
  try{
   const r=await fetch('/api/notifications/channels/verify/confirm',{
    method:'POST',headers:{'Content-Type':'application/json'},
    cache:'no-store',body:JSON.stringify({token}),
   });
   const data=await r.json() as {message?:string};
   if(!r.ok){setError(data.message??'Não foi possível confirmar este link.');return;}
   setDone(true);
  }catch{setError('Não foi possível acessar o servidor.');}
  finally{setBusy(false);}
 }
 return <section className="va-login-side" aria-label="Verificar destino de alertas">
   <div className="va-form">
    <h1>Confirmar e-mail de alertas</h1>
    {done?<><p role="status">Endereço confirmado. Os alertas podem ser enviados conforme as regras e o contrato da organização.</p>
       <Link href="/login">Acessar o VigiaPlus</Link></>:<>
       <p>Ao confirmar, você autoriza o VigiaPlus a enviar notificações de monitoramento para este endereço.</p>
       <button type="button" className="va-submit" disabled={busy||!token}
         onClick={()=>{void confirm();}}>{busy?'Validando…':'Confirmar meu e-mail'}</button>
       {error&&<p role="alert" className="va-form-error">{error}</p>}
     </>}
   </div>
  </section>;
}