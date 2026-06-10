import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { pullFromCloud, startCloudSync, stopCloudSync, clearLocalData } from '../services/cloudSync';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(true);
  const lastUserId = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const userId = session?.user?.id || null;
    if (userId === lastUserId.current) return;
    if (lastUserId.current && !userId) {
      // logout: garante que o último estado foi enviado, depois limpa dados locais
      stopCloudSync(true).then(clearLocalData);
    }
    lastUserId.current = userId;
    if (userId) {
      setSyncing(true);
      pullFromCloud(userId).then(() => {
        startCloudSync(userId);
        setSyncing(false);
      });
    }
  }, [session]);

  const signInWithGoogle = () => supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });

  const signInWithPassword = (email, password) =>
    supabase.auth.signInWithPassword({ email, password });

  const signUp = (email, password, nome) =>
    supabase.auth.signUp({ email, password, options: { data: { full_name: nome } } });

  const logout = () => supabase.auth.signOut();

  const user = session?.user || null;

  return (
    <AuthContext.Provider value={{ user, session, loading: loading || (user && syncing), signInWithGoogle, signInWithPassword, signUp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
