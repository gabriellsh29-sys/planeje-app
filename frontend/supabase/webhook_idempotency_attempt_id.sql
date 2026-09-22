-- =============================================================================
-- Planeje — Fencing token por tentativa no webhook Stripe (22/09/2026, 4ª rodada)
-- =============================================================================
-- NÃO executado automaticamente. Rode no SQL Editor do Supabase ANTES do
-- deploy do código atualizado de api/stripe-webhook.js. O código novo faz
-- INSERT/UPDATE incluindo attempt_id; sem esta coluna, essas chamadas falham
-- e o webhook para de funcionar por completo.
--
-- Por quê: a revisão de 22/09/2026 encontrou 3 falhas confirmadas no
-- mecanismo de retomada de claims travados (webhook_idempotency_status.sql,
-- já aplicada):
--
--   1) Uma tentativa A "lenta mas viva" (não realmente morta) que ultrapassa
--      CLAIM_STALE_MS pode ter sua reivindicação retomada por B. Quando A
--      finalmente termina, ela não tinha como saber que perdeu a posse — o
--      finishEvent() antigo agia só por event_id, então A podia sobrescrever
--      o 'completed' de B (Pergunta 1) ou, se falhasse depois, APAGAR a
--      reivindicação de B por completo (Pergunta 2), quebrando a dedup
--      dessa entrega pra sempre.
--   2) A retomada em si não era atomicamente exclusiva entre múltiplos
--      retomadores concorrentes: o UPDATE de retomada usava
--      `.eq('status','processing')`, mas o valor gravado é o MESMO
--      'processing' de antes — não muda entre retomadas concorrentes, então
--      duas retomadas simultâneas podiam as duas "vencer" (Pergunta 3).
--
-- A correção usa um "fencing token": cada reivindicação (original ou
-- retomada) grava um attempt_id ÚNICO seu. finishEvent() e a própria
-- retomada só têm efeito se o attempt_id ainda for o vigente no banco —
-- comparação feita via WHERE (compare-and-swap), atômica por natureza do
-- UPDATE do Postgres.
--
-- Não apaga nem altera dado existente — coluna nova, nullable (não precisa
-- de DEFAULT: a tabela está vazia em produção, confirmado nas rodadas
-- anteriores desta auditoria).
-- =============================================================================

ALTER TABLE public.stripe_processed_events
  ADD COLUMN IF NOT EXISTS attempt_id text;

COMMENT ON COLUMN public.stripe_processed_events.attempt_id IS
  'Fencing token único por tentativa de processamento (crypto.randomUUID() gerado em api/stripe-webhook.js). Garante que uma tentativa "lenta mas viva" nunca sobrescreva/apague o trabalho de quem retomou a reivindicação dela.';

-- Não amplia nenhuma permissão: a coluna nova fica sujeita ao mesmo
-- REVOKE ALL ON public.stripe_processed_events FROM anon, authenticated já
-- aplicado em webhook_idempotency_events.sql.

-- =============================================================================
-- VALIDAÇÃO PÓS-EXECUÇÃO (só leitura)
-- =============================================================================

-- V1) A coluna existe, tipo certo:
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema='public' and table_name='stripe_processed_events'
--     and column_name='attempt_id';
--   -- esperado: text, is_nullable = YES

-- V2) Tabela continua vazia:
--   select count(*) from public.stripe_processed_events;
--   -- esperado: 0

-- V3) Nenhuma permissão nova pra anon/authenticated:
--   select grantee, privilege_type from information_schema.column_privileges
--   where table_schema='public' and table_name='stripe_processed_events'
--     and column_name='attempt_id' and grantee in ('anon','authenticated');
--   -- esperado: 0 linhas
