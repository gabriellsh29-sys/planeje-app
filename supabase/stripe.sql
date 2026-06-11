-- Colunas para integração com Stripe
alter table public.perfis add column if not exists stripe_customer_id text;
alter table public.perfis add column if not exists stripe_subscription_id text;
