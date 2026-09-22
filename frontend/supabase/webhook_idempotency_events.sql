-- =============================================================================
-- Planeje — Deduplicação de eventos do webhook Stripe por event.id (22/09/2026)
-- =============================================================================
-- NÃO executado automaticamente. Rode no SQL Editor do Supabase ANTES do
-- deploy do código atualizado de api/stripe-webhook.js — o código novo espera
-- esta tabela existir (se não existir, a checagem de dedup falha e o código
-- FAIL-OPEN: loga o erro e segue processando o evento normalmente — não
-- derruba o webhook, mas também não protege contra reentrega até você rodar
-- isto).
--
-- Por quê: a Stripe reentrega o MESMO evento em retries (timeout do nosso
-- lado, 5xx, instabilidade de rede). O handler já é praticamente idempotente
-- por acidente (é um UPDATE que só faz SET), mas isso é frágil — qualquer
-- efeito colateral futuro que não seja um SET puro (enviar e-mail, incrementar
-- contador, criar registro novo) reprocessaria a cada reentrega. Esta tabela
-- registra o event.id já processado com sucesso, e o handler responde 200
-- sem refazer nada se vir de novo.
--
-- Só é marcado como processado DEPOIS de todo o trabalho ter sido concluído
-- sem erro (ver api/stripe-webhook.js) — se a gravação em `perfis` falhar,
-- devolvemos 500 e a Stripe reentrega de verdade (o evento não foi marcado
-- como processado, então o retry processa igual da primeira vez).
--
-- Não apaga nem altera nenhuma tabela existente — cria uma tabela NOVA.
-- Segue exatamente o mesmo padrão já usado em rate-limiting.sql: RLS ligada,
-- ZERO policies, e REVOKE explícito de anon/authenticated — só o
-- service_role (usado pelo backend em api/stripe-webhook.js) acessa.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.stripe_processed_events (
  event_id     text PRIMARY KEY,
  type         text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_processed_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stripe_processed_events FROM anon, authenticated;
-- Nenhuma policy criada de propósito — RLS ligada + zero policies bloqueia
-- anon/authenticated por completo; service_role ignora RLS e continua ok.

COMMENT ON TABLE public.stripe_processed_events IS
  'Dedup de webhooks da Stripe por event.id — evita reprocessar a mesma entrega/retry mais de uma vez. Só service_role acessa (api/stripe-webhook.js).';

-- Manutenção opcional (a tabela cresce 1 linha por evento recebido; eventos
-- de assinatura são poucos por usuário, não é urgente, mas pode limpar de
-- vez em quando os mais antigos, similar ao rate-limiting.sql):
--   DELETE FROM public.stripe_processed_events WHERE processed_at < now() - interval '180 days';

-- =============================================================================
-- VALIDAÇÃO PÓS-EXECUÇÃO (só leitura)
-- =============================================================================

-- V1) A tabela existe com a estrutura certa:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'stripe_processed_events'
--   order by ordinal_position;
--   -- esperado: event_id (text, NO), type (text, YES), processed_at (timestamp with time zone, NO)

-- V2) RLS está ligada e SEM nenhuma policy (bloqueio total pra anon/authenticated):
--   select relrowsecurity from pg_class where relname = 'stripe_processed_events';
--   -- esperado: true
--   select policyname from pg_policies where tablename = 'stripe_processed_events';
--   -- esperado: 0 linhas

-- V3) Nenhuma permissão foi concedida a anon/authenticated:
--   select grantee, privilege_type from information_schema.table_privileges
--   where table_schema = 'public' and table_name = 'stripe_processed_events'
--     and grantee in ('anon', 'authenticated');
--   -- esperado: 0 linhas

-- V4) Tabela nasce vazia (não migra/copia nada de outro lugar):
--   select count(*) from public.stripe_processed_events;
--   -- esperado: 0
