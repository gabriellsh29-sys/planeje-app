-- =============================================================================
-- Planeje — Security Hardening (RLS)
-- =============================================================================
-- Gerado pela auditoria de segurança. NÃO destrói dados: apenas ativa RLS,
-- recria policies precisas e cria índices.
--
-- Tabelas privadas encontradas via `.from('...')` em src/ e api/:
--   1. user_data            (coluna dono: user_id)  -- src/services/cloudSync.js
--   2. user_data_history    (coluna dono: user_id)  -- src/services/cloudSync.js
--   3. perfis               (coluna dono: id)        -- AuthContext.jsx / api/*
--   4. webauthn_credentials (coluna dono: user_id)   -- src/pages/Perfil.jsx / api/*
--   5. webauthn_challenges  (sem dono — só service_role) -- api/_webauthn.js
--
-- ATENÇÃO: `perfis` usa a coluna `id` (= auth.uid()), NÃO `user_id`.
-- As demais usam `user_id`. As policies abaixo respeitam a coluna correta de
-- cada tabela — usar `user_id` em `perfis` faria TODO o app retornar 403.
--
-- Ordem de execução:
--   PARTE 1: RLS + policies + grants  (rode tudo de uma vez / numa transação)
--   PARTE 2: índices CONCURRENTLY     (rode CADA comando SEPARADAMENTE,
--                                       fora de transação — CONCURRENTLY não
--                                       pode rodar dentro de BEGIN/COMMIT)
-- =============================================================================


-- #############################################################################
-- PARTE 1 — RLS, POLICIES E GRANTS
-- #############################################################################

-- -----------------------------------------------------------------------------
-- 1) user_data  (dono: user_id)  — dados financeiros do usuário
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_data ENABLE ROW LEVEL SECURITY;

-- Bloqueia o papel anônimo por completo nesta tabela
REVOKE ALL ON public.user_data FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_data TO authenticated;

-- Remove qualquer policy permissiva pré-existente antes de recriar as precisas
DROP POLICY IF EXISTS "user_data_select" ON public.user_data;
DROP POLICY IF EXISTS "user_data_insert" ON public.user_data;
DROP POLICY IF EXISTS "user_data_update" ON public.user_data;
DROP POLICY IF EXISTS "user_data_delete" ON public.user_data;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.user_data;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.user_data;

CREATE POLICY "user_data_select" ON public.user_data
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_data_insert" ON public.user_data
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_data_update" ON public.user_data
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_data_delete" ON public.user_data
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- 2) user_data_history  (dono: user_id)  — snapshots de histórico
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_data_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_data_history FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_data_history TO authenticated;

DROP POLICY IF EXISTS "user_data_history_select" ON public.user_data_history;
DROP POLICY IF EXISTS "user_data_history_insert" ON public.user_data_history;
DROP POLICY IF EXISTS "user_data_history_update" ON public.user_data_history;
DROP POLICY IF EXISTS "user_data_history_delete" ON public.user_data_history;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.user_data_history;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.user_data_history;

CREATE POLICY "user_data_history_select" ON public.user_data_history
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "user_data_history_insert" ON public.user_data_history
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_data_history_update" ON public.user_data_history
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_data_history_delete" ON public.user_data_history
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- 3) perfis  (dono: id = auth.uid())  — perfil + STATUS DE ASSINATURA
-- -----------------------------------------------------------------------------
-- CRÍTICO / BILLING: esta tabela guarda `plano`, `assinatura_status`,
-- `trial_expira_em`, `stripe_customer_id`, `stripe_subscription_id`.
-- O cliente NÃO PODE poder alterar essas colunas — senão qualquer usuário
-- faria `update perfis set plano='liberado'` e burlaria o paywall.
-- Por isso o GRANT de UPDATE é RESTRITO por coluna (nome, avatar_url).
-- INSERT/DELETE de perfis é feito só server-side (trigger de signup e
-- api/delete-account.js via service_role, que ignora RLS) — sem grant p/ cliente.
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.perfis FROM anon;
REVOKE ALL ON public.perfis FROM authenticated;
-- Só leitura do próprio perfil + update APENAS de nome/avatar_url:
GRANT SELECT ON public.perfis TO authenticated;
GRANT UPDATE (nome, avatar_url) ON public.perfis TO authenticated;

DROP POLICY IF EXISTS "perfis_select" ON public.perfis;
DROP POLICY IF EXISTS "perfis_insert" ON public.perfis;
DROP POLICY IF EXISTS "perfis_update" ON public.perfis;
DROP POLICY IF EXISTS "perfis_delete" ON public.perfis;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.perfis;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.perfis;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.perfis;

CREATE POLICY "perfis_select" ON public.perfis
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- UPDATE só das próprias linhas; as colunas de billing ficam protegidas pelo
-- GRANT restrito acima (o Postgres rejeita update em colunas sem privilégio).
CREATE POLICY "perfis_update" ON public.perfis
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Sem policy de INSERT/DELETE para `authenticated`: essas operações são
-- exclusivamente server-side (service_role). Não conceda grant de INSERT/DELETE.


-- -----------------------------------------------------------------------------
-- 4) webauthn_credentials  (dono: user_id)  — chaves Face ID / passkeys
-- -----------------------------------------------------------------------------
-- Cliente lê e deleta as próprias credenciais (src/pages/Perfil.jsx).
-- INSERT é feito server-side no register-verify (service_role) — sem grant cliente.
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.webauthn_credentials FROM anon;
REVOKE ALL ON public.webauthn_credentials FROM authenticated;
GRANT SELECT, DELETE ON public.webauthn_credentials TO authenticated;

DROP POLICY IF EXISTS "webauthn_credentials_select" ON public.webauthn_credentials;
DROP POLICY IF EXISTS "webauthn_credentials_insert" ON public.webauthn_credentials;
DROP POLICY IF EXISTS "webauthn_credentials_update" ON public.webauthn_credentials;
DROP POLICY IF EXISTS "webauthn_credentials_delete" ON public.webauthn_credentials;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.webauthn_credentials;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.webauthn_credentials;

CREATE POLICY "webauthn_credentials_select" ON public.webauthn_credentials
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "webauthn_credentials_delete" ON public.webauthn_credentials
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- INSERT/UPDATE só server-side (service_role). Sem grant/policy p/ cliente.


-- -----------------------------------------------------------------------------
-- 5) webauthn_challenges  (SEM coluna de dono)  — desafios efêmeros de login
-- -----------------------------------------------------------------------------
-- Acessada SOMENTE via service_role em api/_webauthn.js (antes do login existir
-- uma sessão, a busca é por e-mail). Nenhum papel de cliente pode tocar.
-- RLS ligada + ZERO policies + REVOKE total => anon e authenticated ficam
-- 100% bloqueados; service_role continua funcionando (ignora RLS).
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.webauthn_challenges FROM anon;
REVOKE ALL ON public.webauthn_challenges FROM authenticated;

DROP POLICY IF EXISTS "webauthn_challenges_all" ON public.webauthn_challenges;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.webauthn_challenges;
DROP POLICY IF EXISTS "Enable all for authenticated users" ON public.webauthn_challenges;
-- (Intencionalmente NENHUMA policy criada.)


-- #############################################################################
-- PARTE 2 — ÍNDICES (rode cada linha SEPARADAMENTE, fora de transação)
-- #############################################################################
-- CREATE INDEX CONCURRENTLY não pode rodar dentro de um bloco de transação.
-- No SQL Editor do Supabase, execute uma linha por vez.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_data_user_id
  ON public.user_data (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_data_history_user_id
  ON public.user_data_history (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webauthn_credentials_user_id
  ON public.webauthn_credentials (user_id);

-- perfis.id e as PKs de user_data/user_data_history já são indexadas pela
-- própria PRIMARY KEY / UNIQUE(user_id) — os índices acima cobrem os FKs.
-- webauthn_challenges é consultada por e-mail (service_role):
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webauthn_challenges_email
  ON public.webauthn_challenges (email);


-- #############################################################################
-- VERIFICAÇÃO (opcional) — confirme que RLS está ligada em tudo:
--   SELECT relname, relrowsecurity
--   FROM pg_class
--   WHERE relname IN ('user_data','user_data_history','perfis',
--                     'webauthn_credentials','webauthn_challenges');
-- Todas devem ter relrowsecurity = true.
-- #############################################################################
