'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckCircle2, LockKeyhole, Loader2, ShieldCheck } from 'lucide-react';

export function ConfirmResetForm({token}:{token:string}){
  const[password,setPassword]=useState('');
  const[confirm,setConfirm]=useState('');
  const[error,setError]=useState('');
  const[busy,setBusy]=useState(false);
  const[done,setDone]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');
    if(password.length<12||password.length>128){setError('Use uma senha de 12 a 128 caracteres.');setBusy(false);return;}
    if(password!==confirm){setError('As senhas não coincidem.');setBusy(false);return;}
    try{
      const response=await fetch('/api/auth/password-reset/confirm',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token,password,confirm}),
      });
      const data=await response.json() as {message?:string};
      if(!response.ok){setError(data.message??'O link não pôde ser utilizado.');return;}
      setDone(true);
    }catch{setError('Não foi possível confirmar a nova senha.');}
    finally{setBusy(false);}
  }
  return <section className="va-login-side" aria-label="Definir nova senha">
    <div className="va-form">
      <div className="va-form-logo"><ShieldCheck size={26}/><span>VigiaPlus</span></div>
      {done?<div role="status">
        <CheckCircle2 size={35} color="#16a34a"/>
        <h1>Senha atualizada</h1>
        <p>Todas as sessões antigas foram revogadas. Entre novamente com sua senha pessoal.</p>
        <Link href="/login" className="va-submit">Ir ao login</Link>
      </div>:<>
        <span className="va-form-kicker">REDEFINIÇÃO SEGURA</span>
        <h1>Nova senha</h1>
        <p className="va-form-description">Escolha uma senha de pelo menos 12 caracteres. Este link só funciona uma vez.</p>
        <form onSubmit={submit}>
          <label><span>Nova senha</span><div className="va-field">
            <LockKeyhole size={18}/>
            <input type="password" autoComplete="new-password" required
              minLength={12} maxLength={128} value={password}
              onChange={e=>setPassword(e.target.value)}/></div></label>
          <label><span>Confirmação</span><div className="va-field">
            <LockKeyhole size={18}/>
            <input type="password" autoComplete="new-password" required
              minLength={12} maxLength={128} value={confirm}
              onChange={e=>setConfirm(e.target.value)}/></div></label>
          {error&&<p role="alert" className="va-form-error">{error}</p>}
          <button type="submit" className="va-submit" disabled={busy||!token}>
            {busy&&<Loader2 size={17} className="animate-spin"/>}
            {busy?'Confirmando…':'Atualizar senha'}
          </button>
        </form>
        <Link href="/recuperar">Solicitar outro link</Link>
      </>}
    </div>
  </section>;
}
