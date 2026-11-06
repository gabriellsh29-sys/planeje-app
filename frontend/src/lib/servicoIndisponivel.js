import { useCallback, useEffect, useState } from 'react';

const TIMEOUT_MS = 3000;

// Pergunta ao Supabase se o projeto está restrito (HTTP 402 — ex.: exceed_egress_quota).
// FAIL-OPEN de propósito: só o status 402 conta como "indisponível". Erro de rede,
// timeout, 401, 5xx ou variáveis ausentes devolvem false e o app abre normalmente —
// esta checagem nunca pode trancar o app por dúvida.
export async function projetoRestrito({
  fetchImpl = (typeof fetch === 'function' ? fetch : null),
  url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  if (!fetchImpl || !url || !key) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${String(url).replace(/\/$/, '')}/auth/v1/health`, {
      headers: { apikey: key },
      signal: ctrl.signal,
      cache: 'no-store',
    });
    return res.status === 402;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 'verificando' | 'ok' | 'restrito'. Enquanto restrito, volta a checar sozinho quando
// a aba reaparece (sem intervalo fixo — regra de consumo de GUARDRAILS-CONSUMO).
export function useStatusDoServico() {
  const [status, setStatus] = useState('verificando');

  const verificar = useCallback(async () => {
    const restrito = await projetoRestrito();
    setStatus(restrito ? 'restrito' : 'ok');
    return restrito;
  }, []);

  useEffect(() => { verificar(); }, [verificar]);

  useEffect(() => {
    if (status !== 'restrito') return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') verificar(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status, verificar]);

  return { status, verificar };
}
