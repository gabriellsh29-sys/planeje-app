-- Coluna para foto de perfil
alter table public.perfis add column if not exists avatar_url text;

-- Bucket de avatars (público para leitura)
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatares sao publicos" on storage.objects;
create policy "Avatares sao publicos"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Usuarios enviam seu proprio avatar" on storage.objects;
create policy "Usuarios enviam seu proprio avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Usuarios atualizam seu proprio avatar" on storage.objects;
create policy "Usuarios atualizam seu proprio avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);
