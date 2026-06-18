-- Credenciais de Face ID / Touch ID / Windows Hello (WebAuthn / Passkeys)
create table if not exists public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  credential_id text unique not null,
  public_key text not null,
  counter bigint not null default 0,
  device_name text,
  created_at timestamptz not null default now()
);

alter table public.webauthn_credentials enable row level security;

drop policy if exists "Usuarios veem suas proprias credenciais" on public.webauthn_credentials;
create policy "Usuarios veem suas proprias credenciais"
  on public.webauthn_credentials for select
  using (auth.uid() = user_id);

drop policy if exists "Usuarios removem suas proprias credenciais" on public.webauthn_credentials;
create policy "Usuarios removem suas proprias credenciais"
  on public.webauthn_credentials for delete
  using (auth.uid() = user_id);

-- Inserts/updates só acontecem via service_role (funções serverless), nunca direto do cliente.

-- Desafios temporários de registro/login (curta duração, limpos periodicamente)
create table if not exists public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  challenge text not null,
  created_at timestamptz not null default now()
);

alter table public.webauthn_challenges enable row level security;
-- Sem policies de select/insert/update/delete para clientes: só service_role acessa.

create index if not exists webauthn_challenges_email_idx on public.webauthn_challenges(email);
create index if not exists webauthn_credentials_user_id_idx on public.webauthn_credentials(user_id);
create index if not exists webauthn_credentials_email_idx on public.webauthn_credentials(email);
