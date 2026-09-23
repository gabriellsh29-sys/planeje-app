# Runbook — Teste de restauração de backup (item F do checklist)

Não pude automatizar nem executar este teste: exige ações no painel do
Supabase (Dashboard → Database → Backups) com uma cópia isolada do projeto,
algo que não é possível fazer por código nem por API pública do Supabase.
**NÃO TESTADO nesta auditoria.**

## Por que importa
O app já tem uma camada própria de proteção (`user_data_history`, arquivada
antes de cada escrita — ver `cloudSync.js` e `dataIntegrity.test.js`), mas
isso não substitui testar a restauração de um backup **do banco inteiro**
feita pelo próprio Supabase. Nunca foi confirmado que esse caminho funciona.

## Passos (fazer manualmente, 1x, num projeto separado)

1. No painel do Supabase → **Database → Backups**, confirme que existe pelo
   menos um backup diário recente do projeto de produção.
2. Clique em **Restore** apontando para um **NOVO projeto** (nunca restaure
   por cima da produção). O Supabase cria um projeto isolado a partir do
   backup.
3. No projeto restaurado, confirme:
   - `select count(*) from public.perfis;` e `public.user_data;` batem
     (aproximadamente) com a contagem esperada de usuários ativos.
   - Uma conta específica sua (ex.: a sua própria) aparece com os dados
     financeiros corretos em `user_data.data`.
   - As policies de RLS (`security-hardening.sql` + `paywall_hardening.sql` +
     `security-audit-2026-09.sql`) foram preservadas no restore — rode a
     mesma query de diagnóstico da auditoria de 21/09 (`pg_policies`) e
     compare com o esperado.
4. Apague o projeto de teste depois de confirmar (ele custa/conta como um
   projeto ativo na sua conta Supabase).

## Frequência recomendada
Repetir esse teste a cada 3–6 meses, ou depois de qualquer migração grande de
schema — é o único jeito de saber, ANTES de precisar de verdade, se o backup
automático do Supabase realmente restaura um estado utilizável.
