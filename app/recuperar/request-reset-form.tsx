'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Mail, Loader2, ShieldCheck } from 'lucide-react';

export function RequestResetForm(){
  const[email,setEmail]=useState('');
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState('');
  const[error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setBusy(true);setError('');setMessage('');
    try{
      const result=await fetch('/api/auth/password-reset',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email}),
      });
      const data=await result.json() as {message?:string};
      if(!result.ok) {setError(data.message??'A recuperação não está disponível neste momento.');return;}
      setMessage('Se a conta existir e o serviço de e-mail estiver disponível, você receberá instruções. Verifique sua caixa de entrada.');
    }catch{setError('Não foi possível acessar o serviço.');}
    finally{setBusy(false);}
  }
  return <section className="va-login-side" aria-label="Recuperação de senha">
    <form className="va-form" onSubmit={submit}>
      <div className="va-form-logo"><ShieldCheck size={26}/><span>VigiaPlus</span></div>
      <span className="va-form-kicker">ACESSO SEGURO</span>
      <h1>Recuperar acesso</h1>
      <p className="va-form-description">Informe o e-mail da sua conta. Se houver cadastro, enviaremos instruções de redefinição.</p>
      <label><span>E-mail profissional</span><div className="va-field">
        <Mail size={18}/>
        <input required type="email" autoComplete="email" value={email} maxLength={254}
          onChange={e=>setEmail(e.target.value)} placeholder="seu@email.com"/>
      </div></label>
      {error&&<p role="alert" className="va-form-error">{error}</p>}
      {message&&<p role="status">{message}</p>}
      <button className="va-submit" disabled={busy||!email} type="submit">
        {busy&&<Loader2 size={17} className="animate-spin"/>}
        {busy?'Solicitando…':'Solicitar redefinição'}
      </button>
      <Link href="/login">Voltar ao login</Link>
    </form>
  </section>;
}
