import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { startAuthentication } from '@simplewebauthn/browser';

const LAST_EMAIL_KEY = 'planeje_last_email';
const webauthnSuportado = typeof window !== 'undefined' && !!window.PublicKeyCredential;

export default function LoginPage() {
  const { signInWithGoogle, signInWithPassword, signUp, resendConfirmation, resetPassword, loginWithToken } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'cadastro' | 'recuperar'
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [faceIdLoading, setFaceIdLoading] = useState(false);
  const lastEmail = typeof window !== 'undefined' ? localStorage.getItem(LAST_EMAIL_KEY) : null;

  const loginComFaceId = async () => {
    setError(''); setFaceIdLoading(true);
    try {
      const optsRes = await fetch('/api/webauthn-login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: lastEmail }),
      });
      const options = await optsRes.json();
      if (!optsRes.ok) throw new Error(options.error || 'Face ID não disponível');

      const assertionResponse = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/api/webauthn-login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: lastEmail, assertionResponse }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Não foi possível validar');

      const { error: err } = await loginWithToken(verifyData.token);
      if (err) throw err;
    } catch (err) {
      setError(err.name === 'NotAllowedError' ? 'Cancelado.' : 'Não foi possível entrar com Face ID.');
    }
    setFaceIdLoading(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (mode === 'recuperar') {
      if (!email) { setError('Digite seu e-mail'); return; }
      setLoading(true);
      const { error: err } = await resetPassword(email.trim());
      setLoading(false);
      if (err) setError('Não foi possível enviar o e-mail. Tente novamente.');
      else setInfo('Link enviado! Verifique sua caixa de entrada (e a pasta de spam).');
      return;
    }

    if (!email || !password || (mode === 'cadastro' && !nome)) {
      setError('Preencha todos os campos'); return;
    }
    setLoading(true);
    if (mode === 'login') {
      const { error: err } = await signInWithPassword(email.trim(), password);
      if (err) setError('E-mail ou senha incorretos');
    } else {
      const { error: err } = await signUp(email.trim(), password, nome.trim());
      if (err) {
        if (err.message?.toLowerCase().includes('sending confirmation') || err.message?.toLowerCase().includes('email'))
          setError('Erro ao enviar e-mail de confirmação. Tente novamente em alguns minutos ou entre com Google.');
        else if (err.message?.toLowerCase().includes('already registered') || err.message?.toLowerCase().includes('already been registered'))
          setError('Este e-mail já está cadastrado. Clique em "Entrar".');
        else
          setError('Não foi possível criar a conta. Tente novamente.');
      } else {
        setInfo('Conta criada! Verifique seu e-mail para confirmar o cadastro.');
      }
    }
    setLoading(false);
  };

  const handleGoogle = async () => {
    setError('');
    const { error: err } = await signInWithGoogle();
    if (err) setError('Não foi possível entrar com o Google');
  };

  const goToMode = (m) => { setMode(m); setError(''); setInfo(''); };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{ background: '#0f172a' }}>

      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(34,197,94,0.08) 0%, transparent 70%)',
      }} />

      <div className="w-full max-w-[340px] animate-fade-in relative z-10">

        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="absolute inset-0 rounded-2xl blur-xl" style={{ background: 'rgba(34,197,94,0.2)' }} />
            <img
              src="/img/logo/logo-app-icon.png"
              alt="Planeje"
              className="relative w-20 h-20 object-contain drop-shadow-lg"
            />
          </div>
          <p className="text-white font-bold tracking-tight leading-none"
            style={{ fontSize: 36, fontFamily: 'Poppins, sans-serif' }}>planeje</p>
          <p className="text-accent text-[10px] font-semibold tracking-[0.2em] uppercase mt-1.5">
            Suas Finanças, Seu Futuro.
          </p>
        </div>

        {/* Modo recuperar senha */}
        {mode === 'recuperar' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <p className="text-text-2 text-sm text-center mb-1">
              Digite seu e-mail e enviaremos um link para você criar uma nova senha.
            </p>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Seu e-mail"
              className="input-premium"
              style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
            />
            {error && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-expense text-xs"
                style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                {error}
              </div>
            )}
            {info && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-income text-xs"
                style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                {info}
              </div>
            )}
            <button type="submit" disabled={loading}
              className="btn-gold w-full text-center py-3 disabled:opacity-50 font-semibold mt-2">
              {loading
                ? <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-[#0f172a]/30 border-t-[#0f172a] rounded-full animate-spin" />
                    Enviando...
                  </span>
                : 'Enviar link de recuperação'}
            </button>
            <p className="text-center mt-2">
              <button type="button" onClick={() => goToMode('login')}
                className="text-accent text-sm font-semibold">
                ← Voltar para o login
              </button>
            </p>
          </form>
        )}

        {mode === 'login' && webauthnSuportado && lastEmail && (
          <>
            <button onClick={loginComFaceId} type="button" disabled={faceIdLoading}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition mb-3 disabled:opacity-60"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
              </svg>
              {faceIdLoading ? 'Aguardando confirmação...' : 'Entrar com Face ID'}
            </button>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>ou</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            </div>
          </>
        )}

        {mode !== 'recuperar' && (
          <>
            <button onClick={handleGoogle} type="button"
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm transition mb-4"
              style={{ background: '#ffffff', color: '#1f2937' }}>
              <svg viewBox="0 0 24 24" className="w-4 h-4">
                <path fill="#EA4335" d="M12 10.2v3.84h5.4c-.24 1.32-1.62 3.87-5.4 3.87-3.25 0-5.9-2.69-5.9-6s2.65-6 5.9-6c1.85 0 3.09.79 3.8 1.46l2.59-2.5C17.04 3.05 14.74 2 12 2 6.98 2 2.9 6.06 2.9 11s4.08 9 9.1 9c5.25 0 8.74-3.69 8.74-8.89 0-.6-.07-1.06-.15-1.51H12z"/>
              </svg>
              Continuar com Google
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>ou</span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === 'cadastro' && (
                <input
                  type="text"
                  autoComplete="name"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  placeholder="Seu nome"
                  className="input-premium"
                  style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
                />
              )}

              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="E-mail"
                className="input-premium"
                style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
              />

              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Senha"
                  className="input-premium pr-10"
                  style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
                />
                <button type="button" onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                  tabIndex={-1}>
                  {showPw
                    ? <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
                    : <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.064 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>
                  }
                </button>
              </div>

              {error && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-expense text-xs"
                  style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)' }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                  {error}
                </div>
              )}

              {info && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-income text-xs"
                  style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                  {info}
                </div>
              )}

              <button type="submit" disabled={loading}
                className="btn-gold w-full text-center py-3 disabled:opacity-50 font-semibold mt-2">
                {loading
                  ? <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-[#0f172a]/30 border-t-[#0f172a] rounded-full animate-spin" />
                      Aguarde...
                    </span>
                  : (mode === 'login' ? 'Entrar' : 'Criar conta')}
              </button>
            </form>

            {mode === 'login' && (
              <p className="text-center" style={{ marginTop: 8 }}>
                <button type="button" onClick={() => goToMode('recuperar')}
                  style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}
                  className="hover:text-accent transition-colors">
                  Esqueceu sua senha?
                </button>
              </p>
            )}

            <p className="text-center mt-3" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
              {mode === 'login' ? 'Ainda não tem conta?' : 'Já tem conta?'}{' '}
              <button onClick={() => goToMode(mode === 'login' ? 'cadastro' : 'login')}
                className="text-accent font-semibold">
                {mode === 'login' ? 'Criar conta grátis' : 'Entrar'}
              </button>
            </p>
          </>
        )}

        <p className="text-center mt-5" style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12 }}>
          Planeje · {new Date().getFullYear()} ·{' '}
          <a href="/privacidade" target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Política de Privacidade
          </a>
          {' · '}
          <a href="/termos" target="_blank" rel="noreferrer" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Termos de Uso
          </a>
        </p>
      </div>
    </div>
  );
}
