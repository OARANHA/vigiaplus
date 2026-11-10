'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react';

export function AcceptInviteForm({token}:{token:string}){
  const router=useRouter();
  const [name,setName]=useState('');
  const [password,setPassword]=useState('');
  const [confirm,setConfirm]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(false);
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    setError('');
    if(password.length<12){setError('Escolha uma senha com pelo menos 12 caracteres.');return;}
    if(password!==confirm){setError('As senhas não coincidem.');return;}
    setBusy(true);
    try{
      const res=await fetch('/api/auth/accept-invite',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token,name,password,confirm}),
      });
      const json=await res.json() as {message?:string};
      if(!res.ok){setError(json.message??'O convite não pôde ser utilizado.');return;}
      setDone(true);
    }catch{setError('Falha de comunicação. Refaça a tentativa.');}
    finally{setBusy(false);}
  }
  return <section className="va-login-side" aria-label="Ativação do acesso">
    <div style={{maxWidth:430,width:'100%',margin:'auto',padding:'24px 12px'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:18}}>
        <ShieldCheck size={28}/><strong>Ativação segura</strong>
      </div>
      {done?<>
        <CheckCircle2 size={40} color="#16a34a"/>
        <h1>Conta ativada</h1>
        <p>Seu acesso foi criado. Entre com o e-mail convidado e a senha que você escolheu.</p>
        <button type="button" className="va-submit" onClick={()=>router.replace('/login')}>Acessar login</button>
      </>:<>
        <h1>Crie seu acesso</h1>
        <p>Este convite permite criar sua conta vinculada à organização. A senha não é enviada por e-mail.</p>
        <form onSubmit={submit}>
          <label><span>Nome completo</span><div className="va-field">
            <input required value={name} maxLength={120} minLength={2}
              autoComplete="name" onChange={e=>setName(e.target.value)}
              placeholder="Como deseja ser identificado"/></div></label>
          <label><span>Senha pessoal</span><div className="va-field">
            <LockKeyhole size={18}/>
            <input required type="password" minLength={12} maxLength={128}
              autoComplete="new-password" value={password}
              onChange={e=>setPassword(e.target.value)}
              placeholder="Mínimo de 12 caracteres"/></div></label>
          <label><span>Confirme a senha</span><div className="va-field">
            <LockKeyhole size={18}/>
            <input required type="password" minLength={12} maxLength={128}
              autoComplete="new-password" value={confirm}
              onChange={e=>setConfirm(e.target.value)}/></div></label>
          {error&&<p role="alert" className="va-form-error">{error}</p>}
          <button type="submit" disabled={busy||!name||!password||!confirm||!token}
            className="va-submit">{busy?'Validando…':'Criar conta'}</button>
        </form>
        <p style={{fontSize:12,marginTop:16}}>Seu acesso depende da ativação do contrato e das permissões definidas pelo administrador.</p>
      </>}
    </div>
  </section>;
}
