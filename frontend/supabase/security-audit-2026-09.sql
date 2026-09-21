-- =============================================================================
-- Planeje — Correções da auditoria de segurança (21/09/2026)
-- =============================================================================
-- NÃO foi executado automaticamente. Rode no SQL Editor do Supabase, DEPOIS de
-- conferir os "SELECT de verificação" (ETAPA 0) e ver que batem com o esperado.
-- Nenhum comando aqui apaga dados de usuários.
-- =============================================================================


-- ETAPA 0 — DIAGNÓSTICO (só leitura). Rode primeiro e leia o resultado.
-- -----------------------------------------------------------------------------
-- 0a) Policies ATUAIS do banco (procure user_data_self e perfis_self = legadas):
--   select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname='public'
--   and tablename in ('user_data','user_data_history','perfis','webauthn_credentials')
--   order by tablename, policyname;
--
-- 0b) Quem pode executar fn_usuarios_dados_finos (NÃO pode ser anon/authenticated):
--   select p.proname, p.prosecdef as security_definer,
--          has_function_privilege('anon', p.oid, 'execute')          as anon_pode,
--          has_function_privilege('authenticated', p.oid, 'execute') as auth_pode,
--          has_function_privilege('public', p.oid, 'execute')        as public_pode
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public'
--     and p.proname in ('fn_usuarios_dados_finos','rate_limit_hit','acesso_liberado','handle_new_user');
--
-- 0c) Configuração do bucket de avatares:
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id='avatars';


-- ETAPA 1 — Remove policies LEGADAS que anulam o paywall (schema.sql / user_data.sql)
-- -----------------------------------------------------------------------------
-- Policies permissivas se somam com OR. "user_data_self" (FOR ALL) deixava um
-- usuário com trial vencido continuar escrevendo em user_data, ignorando a regra
-- acesso_liberado() de paywall_hardening.sql.
DROP POLICY IF EXISTS "user_data_self" ON public.user_data;
DROP POLICY IF EXISTS "perfis_self"    ON public.perfis;
-- perfis: o SELECT/UPDATE corretos (perfis_select / perfis_update) já existem em
-- security-hardening.sql e o UPDATE continua restrito às colunas nome/avatar_url.


-- ETAPA 2 — Funções que só o backend (service_role) pode chamar
-- -----------------------------------------------------------------------------
-- REVOKE ... FROM anon, authenticated NÃO basta: o Postgres concede EXECUTE a
-- PUBLIC por padrão e anon/authenticated herdam isso. Sem revogar de PUBLIC, qualquer
-- pessoa com a anon key (pública, visível no F12) chama /rest/v1/rpc/rate_limit_hit
-- e consegue esgotar o limite de login de outro IP ou lotar a tabela rate_limits.
REVOKE ALL ON FUNCTION public.rate_limit_hit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer) TO service_role;

-- Função do monitoramento diário (não está versionada no repositório — foi criada
-- direto no banco). Retorna nome + tamanho dos dados de TODOS os usuários: precisa
-- ser exclusiva do service_role.
DO $$
BEGIN
  IF to_regprocedure('public.fn_usuarios_dados_finos()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.fn_usuarios_dados_finos() FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.fn_usuarios_dados_finos() TO service_role';
  END IF;
END $$;

-- Trigger de signup é SECURITY DEFINER sem search_path fixo: fixa pra evitar
-- sequestro de função/tabela por schema malicioso.
ALTER FUNCTION public.handle_new_user() SET search_path = public;


-- ETAPA 3 — Bucket de avatares: só imagem pequena
-- -----------------------------------------------------------------------------
-- O app já converte a foto pra JPEG no navegador, mas a API do Storage aceita
-- qualquer arquivo de quem tiver um JWT (a policy só confere a pasta). Como o
-- bucket é PÚBLICO, isso permitia hospedar HTML/SVG/qualquer coisa num domínio do
-- Supabase ligado ao Planeje. Limita a 1 MB e a JPEG/PNG/WebP.
UPDATE storage.buckets
   SET file_size_limit    = 1048576,
       allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
 WHERE id = 'avatars';


-- ETAPA 4 — VERIFICAÇÃO FINAL (rode de novo os SELECTs da ETAPA 0):
--   * user_data deve ter APENAS: user_data_select/insert/update/delete
--   * perfis deve ter APENAS: perfis_select, perfis_update
--   * anon_pode/auth_pode/public_pode = false para rate_limit_hit e fn_usuarios_dados_finos
--   * bucket avatars com file_size_limit=1048576
