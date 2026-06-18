-- Concede as permissões de tabela que faltaram na criação via SQL Editor
grant select, insert, update, delete on public.webauthn_challenges to service_role;
grant select, insert, update, delete on public.webauthn_credentials to service_role;
grant select, delete on public.webauthn_credentials to authenticated;
