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
-- Não apaga nem altera dado existente — só adiciona uma coluna nova (NULL por
-- padrão), então linhas antigas continuam intactas e o primeiro evento que
-- chegar depois do deploy passa normalmente (NULL conta como "mais antigo").
-- =============================================================================

ALTER TABLE public.perfis
  ADD COLUMN IF NOT EXISTS stripe_last_event_at timestamptz;

COMMENT ON COLUMN public.perfis.stripe_last_event_at IS
  'Timestamp (event.created da Stripe) do último webhook de assinatura aplicado a esta linha. Usado por api/stripe-webhook.js para ignorar eventos entregues fora de ordem.';
