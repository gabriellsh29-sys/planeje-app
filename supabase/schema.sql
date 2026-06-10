-- PLANEJE — schema Supabase (rodar no SQL Editor do projeto)

-- Perfil do usuário: plano (free/pago), validade do trial, saldo inicial
create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  plano text not null default 'free',
  trial_expira_em timestamptz default (now() + interval '14 days'),
  assinatura_status text default 'inativa',
  saldo_inicial numeric(12,2) not null default 0,
  created_at timestamptz default now()
);

create table public.dividas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  categoria text,
  valor numeric(12,2) not null default 0,
  vencimento date,
  observacao text,
  recorrencia text not null default 'nao',
  parcela_inicial int,
  total_parcelas int,
  periodicidade text,
  pago boolean default false,
  pagamento_data date,
  valor_pago numeric(12,2),
  pagamentos jsonb default '{}',
  overrides jsonb default '{}',
  historico jsonb default '[]',
  criado_em timestamptz default now()
);

create table public.receitas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  categoria text,
  valor numeric(12,2) not null default 0,
  data date,
  recorrencia text not null default 'nao',
  periodicidade text,
  observacao text,
  recebida boolean default false,
  recebimento_data date,
  valor_recebido numeric(12,2),
  criado_em timestamptz default now()
);

create table public.cartoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null,
  cor text,
  limite numeric(12,2),
  dia_fechamento int,
  dia_pagamento int,
  faturas_pagas jsonb default '{}',
  criado_em timestamptz default now()
);

create table public.faturas_lancamentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cartao_id uuid not null references public.cartoes(id) on delete cascade,
  descricao text not null,
  valor numeric(12,2) not null default 0,
  parcelas int default 1,
  mes int not null,
  ano int not null,
  criado_em timestamptz default now()
);

-- RLS: cada usuário só acessa os próprios dados
alter table public.perfis enable row level security;
alter table public.dividas enable row level security;
alter table public.receitas enable row level security;
alter table public.cartoes enable row level security;
alter table public.faturas_lancamentos enable row level security;

create policy "perfis_self" on public.perfis
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "dividas_self" on public.dividas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "receitas_self" on public.receitas
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "cartoes_self" on public.cartoes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "faturas_self" on public.faturas_lancamentos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Cria automaticamente um perfil quando um novo usuário se cadastra
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
