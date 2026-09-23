-- =============================================================================
-- Planeje — Reivindicação atômica de eventos do webhook Stripe (22/09/2026, 3ª rodada)
-- =============================================================================
-- NÃO executado automaticamente. Rode no SQL Editor do Supabase ANTES do
-- deploy do código atualizado de api/stripe-webhook.js — o código novo
-- INSERE com status='processing' e depois faz UPDATE pra 'completed'; sem
-- esta coluna, o INSERT falha (NOT NULL sem default) e o webhook nunca
-- conseguiria reivindicar nenhum evento.
--
-- Por quê: a versão anterior (webhook_idempotency_events.sql, já aplicada)
-- fazia SELECT pra checar duplicata e só inseria a linha de dedup no FINAL,
-- depois de processar. Isso tem uma janela de corrida real — duas entregas
-- SIMULTÂNEAS do mesmo event.id podiam as duas passar pelo SELECT (nenhuma
-- via a outra ainda) e as duas processarem o evento. A correção usa o
-- próprio INSERT (com event_id como PRIMARY KEY) como trava atômica: só uma
-- entrega consegue inserir a linha 'processing' primeiro; a outra recebe
-- conflito de chave (23505) e nunca reprocessa o mesmo evento.
--
-- A coluna 'status' permite distinguir, quando um conflito de chave acontece:
--   'completed'  → o evento já foi processado com sucesso antes → duplicata
--                  legítima, responde 200 sem refazer nada.
--   'processing' → outra tentativa está processando ESTE evento agora (ou
--                  reivindicou há pouco) → não processamos aqui, pedimos
--                  retry à Stripe (nunca duplicamos o efeito).
-- Se uma tentativa falha no meio (erro, timeout, crash do processo), o
-- código APAGA a própria linha de reivindicação antes de devolver erro — a
-- próxima reentrega da Stripe encontra o event_id livre e reprocessa de
-- verdade. Isso resolve o requisito de "comportamento correto após falhas
-- parciais" (sem esta coluna, uma tentativa que travasse no meio deixaria o
-- event_id marcado como processado incorretamente, ou a versão anterior sem
-- distinção de estado não teria como saber se era seguro reprocessar).
--
-- Não apaga nem altera dado existente — ADD COLUMN NOT NULL precisa de um
-- DEFAULT pra linhas já existentes; a tabela public.stripe_processed_events
-- está VAZIA em produção (confirmado na validação de 22/09/2026), então o
-- valor do default é irrelevante na prática, mas 'completed' é o
-- semanticamente correto caso algum dia haja linhas herdadas do formato
-- antigo (que só existiam depois de processamento bem-sucedido).
-- =============================================================================

ALTER TABLE public.stripe_processed_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed';

COMMENT ON COLUMN public.stripe_processed_events.status IS
  'processing = reivindicado, ainda em andamento (ou tentativa anterior travada); completed = processado com sucesso, dedup real de reentregas futuras.';

-- Não amplia nenhuma permissão: a coluna nova fica sujeita ao mesmo
-- REVOKE ALL ON public.stripe_processed_events FROM anon, authenticated já
-- aplicado em webhook_idempotency_events.sql — não é preciso repetir.

-- =============================================================================
-- VALIDAÇÃO PÓS-EXECUÇÃO (só leitura)
-- =============================================================================

-- V1) A coluna existe, tipo certo, NOT NULL:
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema='public' and table_name='stripe_processed_events'
--     and column_name='status';
--   -- esperado: text, is_nullable=NO, column_default contém 'completed'

-- V2) Tabela continua vazia (nada foi inserido por esta migration):
--   select count(*) from public.stripe_processed_events;
--   -- esperado: 0

-- V3) Nenhuma permissão nova pra anon/authenticated:
--   select grantee, privilege_type from information_schema.column_privileges
--   where table_schema='public' and table_name='stripe_processed_events'
--     and column_name='status' and grantee in ('anon','authenticated');
--   -- esperado: 0 linhas
