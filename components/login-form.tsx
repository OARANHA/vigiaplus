'use client';
import { useState } from 'react';
import { Eye, EyeOff, Loader2, LockKeyhole, Mail, Radar } from 'lucide-react';
import type { Locale } from '@/lib/i18n-dict';

export function LoginForm({ locale: _locale }: { locale: Locale }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(res.status === 429
          ? 'Muitas tentativas de acesso. Aguarde antes de tentar novamente.'
          : 'E-mail ou senha inválidos. Verifique os dados e tente novamente.');
        return;
      }
      const target = data.mustChangePassword ? '/impostazioni/account?first=1'
        : data.redirectTo === '/console' || data.redirectTo === '/portal'
          ? data.redirectTo : '/';
      window.location.replace(target);
    } catch {
      setError('Não foi possível conectar ao servidor. Tente novamente.');
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="va-form">
      <div className="va-form-logo"><Radar size={27}/><span>VigiaPlus</span></div>
      <span className="va-form-kicker">ÁREA SEGURA</span>
      <h1>Acesse sua inteligência.</h1>
      <p className="va-form-description">
        Entre para acompanhar o monitoramento e as informações autorizadas para sua conta.
      </p>
      <label htmlFor="vigia-login-email">
        <span>E-mail</span>
        <div className="va-field">
          <Mail size={18}/>
          <input id="vigia-login-email" name="email" type="email" required autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com" aria-label="E-mail profissional" autoFocus />
        </div>
      </label>
      <label htmlFor="vigia-login-password">
        <span>Senha</span>
        <div className="va-field">
          <LockKeyhole size={18}/>
          <input id="vigia-login-password" name="password" type={visible ? 'text' : 'password'}
            required autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="Sua senha" aria-label="Senha"/>
          <button type="button" aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            onClick={() => setVisible((v) => !v)}>
            {visible ? <EyeOff size={18}/> : <Eye size={18}/>}
          </button>
        </div>
      </label>
      {error && <p role="alert" className="va-form-error">{error}</p>}
      <button type="submit" className="va-submit" disabled={busy || !email || !password}>
        {busy && <Loader2 size={17} className="animate-spin"/>}
        {busy ? 'Autenticando…' : 'Entrar no VigiaPlus'} <span aria-hidden="true">→</span>
      </button>
      <p className="va-form-footer">Acesso protegido · Cada cliente visualiza somente seus dados autorizados</p>
    </form>
  );
}
