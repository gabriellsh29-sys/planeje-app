-- #############################################################################
-- Rate limiting distribuído (compartilhado entre instâncias serverless)
--
-- Antes, o rate limit em api/_security.js era um Map em memória: cada instância
-- serverless da Vercel (e cada cold start) tem seu próprio contador, então um
-- atacante distribuindo requisições na prática não era limitado de verdade.
-- Isso cria uma tabela + função atômica no Postgres, usada só pelo backend
-- (service_role) — nenhum usuário final acessa essa tabela diretamente.
--
-- Rodar este arquivo inteiro de uma vez no SQL Editor do Supabase Dashboard.
-- Se você ainda não rodar isso, nada quebra: o código (api/_security.js) já
-- tem fallback automático pro limite em memória (proteção básica de antes)
-- enquanto essa função não existir.
-- #############################################################################

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count        integer     NOT NULL DEFAULT 1
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy é criada de propósito: com RLS ligada e zero policies, anon e
-- authenticated não conseguem ler/escrever nada. Só o service_role (usado pelo
-- backend em api/_security.js) acessa essa tabela, e service_role ignora RLS.
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- Incrementa (ou reinicia, se a janela expirou) o contador da chave de forma
-- atômica num único statement — evita a race condition de "ler, decidir, escrever"
-- em JS quando duas requisições da mesma chave chegam quase ao mesmo tempo.
CREATE OR REPLACE FUNCTION public.rate_limit_hit(p_key text, p_window_ms integer, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rate_limits (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN public.rate_limits.window_start < now() - make_interval(secs => p_window_ms / 1000.0)
        THEN 1
        ELSE public.rate_limits.count + 1
      END,
    window_start = CASE
      WHEN public.rate_limits.window_start < now() - make_interval(secs => p_window_ms / 1000.0)
        THEN now()
        ELSE public.rate_limits.window_start
      END
  RETURNING count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- Só o service_role deve poder chamar esta função (é ele quem faz a checagem no backend).
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM anon, authenticated;

-- Limpeza periódica: sem isso a tabela cresce para sempre (1 linha por combinação
-- key:ip já vista). Rode manualmente de vez em quando, ou configure um cron job no
-- Supabase (Database → Cron Jobs) apontando pra este DELETE, ex. a cada 1h:
--   DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
