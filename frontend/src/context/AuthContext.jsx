import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { pullFromCloud, startCloudSync, stopCloudSync, clearLocalData } from '../services/cloudSync';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(true);
  const [perfil, setPerfil] = useState(null);
  // Estado do fetch do perfil para gating fail-closed do acesso:
  //   'loading' -> ainda buscando (mostra spinner, acesso NEGADO)
  //   'loaded'  -> perfil confirmado do servidor (avalia plano)
  //   'error'   -> falha definitiva após retries (acesso NEGADO, mostra retry)
  const [perfilStatus, setPerfilStatus] = useState('loading');
  const [isRecovery, setIsRecovery] = useState(false);
  const lastUserId = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const userId = session?.user?.id || null;
    if (userId === lastUserId.current) return;
    const prevUserId = lastUserId.current;
    lastUserId.current = userId;
    if (prevUserId && !userId) {
      // logout: envia último estado mas NUNCA apaga dados locais
      // (clearLocalData foi removido — apagar local quando push pode ter falhado = perda irrecuperável)
      stopCloudSync(true).catch(() => {});
      setPerfil(null);
      setPerfilStatus('loading');
      return;
    }
    if (userId) {
      if (session.user.email) localStorage.setItem('planeje_last_email', session.user.email.toLowerCase());
      setSyncing(true);
      // Fail-closed: até o perfil ser confirmado, acesso permanece negado.
      setPerfilStatus('loading');
      // Só limpa local ao trocar de usuário na mesma sessão (ex: logout/login de outra conta no mesmo device)
      if (prevUserId && prevUserId !== userId) {
        clearLocalData();
      }
      // startCloudSync é chamado imediatamente — não pode depender de queries que podem falhar
      startCloudSync(userId);

      // cancelled evita que retries de um userId anterior atualizem o perfil
      // depois de logout ou troca de conta (cross-account bleed)
      let cancelled = false;
      // Agenda retry; se os retries se esgotarem, marca ERRO (fail-closed) —
      // nunca deixa o perfil indefinido virar "acesso liberado".
      const retryOrFail = (attempt) => {
        if (attempt < 3) setTimeout(() => { if (!cancelled) fetchPerfil(attempt + 1); }, 2000 * (attempt + 1));
        else if (!cancelled) setPerfilStatus('error');
      };
      const fetchPerfil = (attempt = 0) =>
        supabase.from('perfis').select('nome, plano, trial_expira_em, assinatura_status, avatar_url').eq('id', userId).maybeSingle()
          .then(({ data, error }) => {
            if (cancelled) return;
            if (error) { retryOrFail(attempt); return; }
            if (data) { setPerfil(data); setPerfilStatus('loaded'); }
            else retryOrFail(attempt);
          })
          .catch(() => {
            if (cancelled) return;
            retryOrFail(attempt);
          });

      Promise.all([
        pullFromCloud(userId).catch(() => {}),
        fetchPerfil(),
      ]).finally(() => {
        if (!cancelled) setSyncing(false);
      });

      return () => { cancelled = true; };
    } else {
      setPerfil(null);
    }
  }, [session]);

  const refreshPerfil = async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    const { data } = await supabase.from('perfis').select('nome, plano, trial_expira_em, assinatura_status, avatar_url').eq('id', userId).maybeSingle();
    // Só promove para 'loaded' quando há perfil confirmado; nunca zera o perfil
    // existente durante o polling de pagamento (data null = mantém o atual).
    if (data) { setPerfil(data); setPerfilStatus('loaded'); }
  };

  // Retry manual disparado pelo botão da tela de erro (fail-closed).
  const retryPerfil = async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    setPerfilStatus('loading');
    try {
      const { data, error } = await supabase.from('perfis').select('nome, plano, trial_expira_em, assinatura_status, avatar_url').eq('id', userId).maybeSingle();
      if (error) { setPerfilStatus('error'); return; }
      if (data) { setPerfil(data); setPerfilStatus('loaded'); }
      else setPerfilStatus('error');
    } catch {
      setPerfilStatus('error');
    }
  };

  const signInWithGoogle = () => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://www.planejeapp.com.br' },
  });

  const signInWithPassword = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });

  const signUp = (email, password, nome) =>
    supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: nome },
        emailRedirectTo: 'https://www.planejeapp.com.br',
      },
    });

  const resendConfirmation = (email) =>
    supabase.auth.resend({ type: 'signup', email });

  const resetPassword = (email) =>
    supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://www.planejeapp.com.br',
    });

  const updatePassword = async (password) => {
    const result = await supabase.auth.updateUser({ password });
    if (!result.error) {
      setIsRecovery(false);
      await supabase.auth.signOut();
    }
    return result;
  };

  // O token vindo de admin.generateLink é um "hashed_token" (token_hash), não o
  // código de 6 dígitos — por isso usa o parâmetro token_hash, não token+email.
  const loginWithToken = (token) =>
    supabase.auth.verifyOtp({ token_hash: token, type: 'magiclink' });

  const logout = () => supabase.auth.signOut();

  const user = session?.user || null;

  // FAIL-CLOSED: só libera acesso quando o perfil foi CONFIRMADO carregado do
  // servidor E o plano é válido. Perfil ausente/carregando/erro => NEGADO.
  // Falha de rede NUNCA é tratada como assinatura válida.
  const acessoLiberado = perfilStatus === 'loaded' && perfil != null && (
    perfil.plano === 'liberado'
    || (perfil.plano === 'pago' && perfil.assinatura_status === 'ativa')
    || (!!perfil.trial_expira_em && new Date(perfil.trial_expira_em) > new Date())
  );

  return (
    <AuthContext.Provider value={{ user, session, perfil, perfilStatus, acessoLiberado, isRecovery, refreshPerfil, retryPerfil, loading: loading || (user && syncing), signInWithGoogle, signInWithPassword, signUp, resendConfirmation, resetPassword, updatePassword, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
