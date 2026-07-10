import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { pullFromCloud, startCloudSync, stopCloudSync, clearLocalData } from '../services/cloudSync';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(true);
  const [perfil, setPerfil] = useState(null);
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
      return;
    }
    if (userId) {
      if (session.user.email) localStorage.setItem('planeje_last_email', session.user.email.toLowerCase());
      setSyncing(true);
      // Só limpa local ao trocar de usuário na mesma sessão (ex: logout/login de outra conta no mesmo device)
      if (prevUserId && prevUserId !== userId) {
        clearLocalData();
      }
      // startCloudSync é chamado imediatamente — não pode depender de queries que podem falhar
      startCloudSync(userId);

      // cancelled evita que retries de um userId anterior atualizem o perfil
      // depois de logout ou troca de conta (cross-account bleed)
      let cancelled = false;
      const fetchPerfil = (attempt = 0) =>
        supabase.from('perfis').select('nome, plano, trial_expira_em, assinatura_status, avatar_url').eq('id', userId).maybeSingle()
          .then(({ data }) => {
            if (cancelled) return;
            if (data) setPerfil(data);
            else if (attempt < 3) setTimeout(() => { if (!cancelled) fetchPerfil(attempt + 1); }, 2000 * (attempt + 1));
          })
          .catch(() => {
            if (cancelled) return;
            if (attempt < 3) setTimeout(() => { if (!cancelled) fetchPerfil(attempt + 1); }, 2000 * (attempt + 1));
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
    setPerfil(data);
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

  const acessoLiberado = !perfil || perfil.plano === 'liberado'
    || (perfil.plano === 'pago' && perfil.assinatura_status === 'ativa')
    || (perfil.trial_expira_em && new Date(perfil.trial_expira_em) > new Date());

  return (
    <AuthContext.Provider value={{ user, session, perfil, acessoLiberado, isRecovery, refreshPerfil, loading: loading || (user && syncing), signInWithGoogle, signInWithPassword, signUp, resendConfirmation, resetPassword, updatePassword, loginWithToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
