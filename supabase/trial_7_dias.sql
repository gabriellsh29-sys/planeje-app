-- Ajusta o trial padrão de novos cadastros para 7 dias
alter table public.perfis alter column trial_expira_em set default (now() + interval '7 days');
