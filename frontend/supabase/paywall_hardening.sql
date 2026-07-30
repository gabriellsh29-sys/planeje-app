-- Planeje - Paywall Hardening (RLS em user_data)
--
-- Roda DEPOIS de security-hardening.sql. Fecha o bypass de paywall: hoje
-- "user_data_insert"/"user_data_update" so checam auth.uid() = user_id, entao
-- um usuario com trial expirado ou assinatura inativa consegue continuar
-- escrevendo dados chamando supabase.from('user_data')... direto do browser
-- (tem a anon key + o proprio JWT), contornando o paywall que hoje so e
-- reforcado no frontend (AuthContext.jsx -> acessoLiberado).
--
-- Esta migration espelha no banco a MESMA regra de acessoLiberado:
--   plano = 'liberado'
--   OR (plano = 'pago' AND assinatura_status = 'ativa')
--   OR trial_expira_em > now()

create or replace function public.acesso_liberado(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        perfis.plano = 'liberado'
        or (perfis.plano = 'pago' and perfis.assinatura_status = 'ativa')
        or (perfis.trial_expira_em is not null and perfis.trial_expira_em > now())
      from public.perfis
      where perfis.id = p_user_id
    ),
    false
  );
$$;

revoke all on function public.acesso_liberado(uuid) from public;
grant execute on function public.acesso_liberado(uuid) to authenticated;

-- So as policies de escrita mudam. SELECT/DELETE continuam liberados pro dono
-- da linha (ver os dados/apagar a conta nao deve depender do paywall).
drop policy if exists "user_data_insert" on public.user_data;
drop policy if exists "user_data_update" on public.user_data;

create policy "user_data_insert" on public.user_data
  for insert to authenticated
  with check (auth.uid() = user_id and public.acesso_liberado(user_id));

create policy "user_data_update" on public.user_data
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.acesso_liberado(user_id));

-- VERIFICACAO (opcional):
--   select public.acesso_liberado(auth.uid()); -- rode logado como um usuario de teste
