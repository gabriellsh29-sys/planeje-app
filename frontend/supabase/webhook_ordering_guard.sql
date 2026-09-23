-- =============================================================================
-- Planeje — Guarda de ordenação de eventos do webhook Stripe (22/09/2026)
-- =============================================================================
-- NÃO executado automaticamente. Rode no SQL Editor do Supabase ANTES de fazer
-- o deploy do código atualizado de api/stripe-webhook.js (ver PR/branch
-- security/test-suite-2026-09-22) — o código novo espera esta coluna existir.
--
-- Por quê: a Stripe não garante que webhooks chegam na ordem em que os
-- eventos aconteceram (rede, retries, filas). O handler atual aplica o status
-- de "customer.subscription.updated/deleted" às cegas, então um evento antigo
-- reentregue/atrasado depois de um evento mais novo pode REATIVAR uma
-- assinatura que já foi cancelada. Confirmado pelo teste 20 de
-- src/__tests__/api-security.test.js.
--
-- Não apaga nem altera dado existente — ALTER TABLE ... ADD COLUMN (sem
-- DEFAULT) é uma operação só de metadado no Postgres: não reescreve a
-- tabela, não bloqueia leituras/escritas concorrentes de forma relevante, e
-- toda linha existente recebe NULL automaticamente.
--
-- Inicialização para assinaturas JÁ EXISTENTES: ficam com stripe_last_event_at
-- = NULL. O handler trata NULL como "ainda não há guarda pra esta linha" (via
-- `stripe_last_event_at.is.null`), então o PRÓXIMO webhook de cada assinatura
-- existente é aceito normalmente e passa a preencher a coluna a partir daí.
-- Não há (nem é possível ter) proteção retroativa para eventos já
-- processados antes desta coluna existir — isso é esperado e não é uma
-- regressão de segurança, só significa que a guarda "esquenta" a partir do
-- primeiro evento pós-deploy de cada assinatura.
--
-- Permissões: esta migration NÃO concede nenhum GRANT novo. A coluna nova
-- fica sujeita às mesmas policies/RLS/GRANTs já vigentes em public.perfis
-- (GRANT UPDATE restrito a nome/avatar_url para o cliente — ver
-- security-hardening.sql). O cliente autenticado NÃO ganha permissão de
-- gravar em stripe_last_event_at; só o service_role (usado pelo webhook)
-- consegue, porque o webhook ignora RLS.
-- =============================================================================

ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS stripe_last_event_at timestamptz;

COMMENT ON COLUMN public.perfis.stripe_last_event_at IS
  'Timestamp (event.created da Stripe) do último webhook de assinatura aplicado a esta linha. Usado por api/stripe-webhook.js para ignorar eventos entregues fora de ordem.';

-- =============================================================================
-- VALIDAÇÃO PÓS-EXECUÇÃO (só leitura — rode cada bloco separadamente e
-- confira o resultado antes de prosseguir para o deploy do código)
-- =============================================================================

-- V1) A coluna existe, é nullable e do tipo certo:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'perfis'
--     and column_name = 'stripe_last_event_at';
--   -- esperado: 1 linha — timestamp with time zone, is_nullable = YES

-- V2) Nenhuma linha existente foi alterada além da coluna nova (todas NULL
--     logo após a migration — nenhum backfill foi feito):
--   select count(*) as total,
--          count(*) filter (where stripe_last_event_at is not null) as com_valor,
--          count(*) filter (where stripe_last_event_at is null)     as sem_valor
--   from public.perfis;
--   -- esperado: com_valor = 0 (até o próximo webhook chegar pra alguém)

-- V3) Contagem de linhas não mudou (nenhum dado foi perdido) — compare o
--     "total" acima com a contagem ANTES da migration (rode isto antes e
--     depois e compare os dois números):
--   select count(*) from public.perfis;

-- V4) Nenhum GRANT novo foi criado na coluna (cliente continua sem poder
--     escrever nela):
--   select grantee, privilege_type, column_name
--   from information_schema.column_privileges
--   where table_schema = 'public' and table_name = 'perfis'
--     and column_name = 'stripe_last_event_at';
--   -- esperado: 0 linhas, OU apenas linhas com grantee = 'service_role'/'postgres'
--   --           (NUNCA 'anon' nem 'authenticated' com privilege_type = 'UPDATE')

-- V5) Policies de RLS de perfis continuam as mesmas de antes da migration
--     (ALTER TABLE ADD COLUMN não deveria mexer nisso, mas confirme):
--   select policyname, cmd, roles from pg_policies
--   where schemaname = 'public' and tablename = 'perfis' order by policyname;
--   -- esperado: só perfis_select (SELECT) e perfis_update (UPDATE), ambas
--   --           roles = {authenticated} — igual à auditoria de 21/09/2026
