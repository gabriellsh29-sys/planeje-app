# Checklist de Configuração Manual — Supabase Dashboard + Vercel Dashboard

Gerado pela auditoria de segurança do Planeje (planejeapp.com.br).  
Todos os valores abaixo foram extraídos diretamente do código-fonte (AuthContext.jsx, api/*).  
NÃO invenções — cada item tem a referência de arquivo.

---

## 1. Supabase Dashboard — Authentication > URL Configuration

**URL exata a configurar:**

| Campo | Valor | Fonte no código |
|---|---|---|
| Site URL | `https://www.planejeapp.com.br` | AuthContext.jsx linha 86 (`signInWithOAuth` > `redirectTo`) |
| Redirect URLs (adicionar cada linha) | `https://www.planejeapp.com.br` | AuthContext.jsx linha 86, 98, 107 |
| Redirect URLs | `https://www.planejeapp.com.br/**` | Necessário para rotas internas |

**Atenção:** Qualquer URL de preview (Vercel, localhost) que precisar de OAuth deve ser adicionada explicitamente aqui.  
Exemplos comuns a adicionar se necessário:
- `http://localhost:5173` (dev local)
- `https://*.vercel.app` (previews — só se o OAuth em preview for necessário)

**Como acessar:**  
`Supabase Dashboard → Project → Authentication → URL Configuration`

---

## 2. Supabase Dashboard — Authentication > Providers > Google

Configurar o provedor Google OAuth:

1. Acessar: `Authentication → Providers → Google`
2. Habilitar "Google"
3. Preencher:
   - **Client ID**: (obtido no Google Cloud Console)
   - **Client Secret**: (obtido no Google Cloud Console)
4. No Google Cloud Console (`console.cloud.google.com`):
   - Criar um OAuth 2.0 Client ID do tipo "Web application"
   - Authorized redirect URIs: `https://<SEU_PROJECT_REF>.supabase.co/auth/v1/callback`
     - Substitua `<SEU_PROJECT_REF>` pelo Project Reference ID do seu projeto Supabase
     - Encontre em: `Supabase Dashboard → Project Settings → General → Reference ID`

---

## 3. Supabase Dashboard — SQL Editor — Executar security-hardening.sql

O arquivo `supabase/security-hardening.sql` deve ser executado no SQL Editor:

1. Acessar: `Supabase Dashboard → SQL Editor`
2. Colar **a PARTE 1 inteira** (RLS + POLICIES + GRANTS) e executar como uma transação
3. Executar **cada CREATE INDEX CONCURRENTLY** da PARTE 2 **separadamente**, fora de transação
   - `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_data_user_id ...`
   - `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_data_history_user_id ...`
   - `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webauthn_credentials_user_id ...`
   - `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webauthn_challenges_email ...`

**Verificar depois:**
```sql
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('user_data','user_data_history','perfis',
                  'webauthn_credentials','webauthn_challenges');
```
Todas as linhas devem ter `relrowsecurity = true`.

---

## 4. Supabase Dashboard — Storage — Bucket "avatars"

1. Acessar: `Storage → Buckets → avatars`
2. Verificar que o bucket **NÃO é público** (ou, se for público para leitura de URL, que apenas o próprio usuário pode fazer upload)
3. Configurar RLS no bucket se ainda não estiver configurado:
   - Policy de SELECT (leitura pública ou autenticada — para exibir avatar)
   - Policy de INSERT/UPDATE: `auth.uid()::text = (storage.foldername(name))[1]`
     - Isso garante que o usuário só pode enviar para `<user_id>/avatar.jpg` (correspondente ao path em `src/pages/Perfil.jsx` linha 174)

---

## 5. Supabase Dashboard — Edge Functions ou Triggers (se aplicável)

Se houver um trigger de banco de dados para criar automaticamente uma linha em `perfis` após signup:
- Verificar que o trigger usa `SECURITY DEFINER` e cria a linha com `id = auth.uid()`, `plano = 'trial'` (ou equivalente).
- O trigger é necessário porque `INSERT` em `perfis` não é concedido ao papel `authenticated` (por segurança: o cliente não pode criar seu próprio perfil com `plano = 'liberado'`).

---

## 6. Vercel Dashboard — Environment Variables

Acessar: `Vercel Dashboard → Project → Settings → Environment Variables`

Configurar as seguintes variáveis, **nos ambientes corretos**:

### Variáveis do Frontend (VITE_ — aparecem no bundle do browser — NÃO SECRETAS)

| Nome | Ambiente | Descrição | Fonte no código |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Production, Preview, Development | URL pública do projeto Supabase | src/lib/supabaseClient.js |
| `VITE_SUPABASE_ANON_KEY` | Production, Preview, Development | Chave anon pública do Supabase | src/lib/supabaseClient.js |
| `VITE_STRIPE_PRICE_MENSAL` | Production | Price ID do plano mensal no Stripe | src/components/PaywallPage.jsx, src/pages/Perfil.jsx |
| `VITE_STRIPE_PRICE_ANUAL` | Production | Price ID do plano anual no Stripe | src/components/PaywallPage.jsx, src/pages/Perfil.jsx |
| `VITE_SENTRY_DSN` | Production | DSN do Sentry (opcional) | src/main.jsx |

### Variáveis do Servidor (SEM VITE_ — NUNCA expostas no browser — SECRETAS)

| Nome | Ambiente | Descrição | Fonte no código |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Production | Chave secreta do Stripe (`sk_live_...`) | api/create-checkout-session.js, api/create-portal-session.js, api/delete-account.js, api/stripe-webhook.js |
| `STRIPE_WEBHOOK_SECRET` | Production | Secret de webhook do Stripe (`whsec_...`) | api/stripe-webhook.js linha 48 |
| `SUPABASE_SERVICE_ROLE_KEY` | Production | Chave service_role do Supabase (ignora RLS) | api/_security.js, api/_webauthn.js, api/stripe-webhook.js, api/create-portal-session.js, api/delete-account.js |
| `RESEND_API_KEY` | Production | Chave API do Resend (alertas de erro por e-mail) | api/stripe-webhook.js linha 23 |

**CRÍTICO:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e `SUPABASE_SERVICE_ROLE_KEY` devem ser configuradas **APENAS em Production** (não em Preview, não em Development). Se precisar de preview funcional com pagamentos, usar chaves de teste (`sk_test_...`) separadas.

---

## 7. Vercel Dashboard — Webhook do Stripe

1. No Stripe Dashboard: `Developers → Webhooks → Add endpoint`
2. **Endpoint URL**: `https://www.planejeapp.com.br/api/stripe-webhook`
3. **Eventos a escutar** (baseado em api/stripe-webhook.js):
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Após criar, copiar o **Signing Secret** (`whsec_...`) e colocar em `STRIPE_WEBHOOK_SECRET` na Vercel

---

## 8. Verificação Final Pós-Deploy

- [ ] Login com Google redireciona para `https://www.planejeapp.com.br` (não localhost)
- [ ] Criação de conta envia e-mail com link apontando para `https://www.planejeapp.com.br`
- [ ] Reset de senha redireciona para `https://www.planejeapp.com.br`
- [ ] Webhook do Stripe retorna `200 OK` para `checkout.session.completed`
- [ ] RLS ativa: um usuário logado NÃO consegue ler dados de outro usuário via Supabase SDK
- [ ] `perfis.plano` e `perfis.assinatura_status` NÃO podem ser alterados via cliente autenticado (testado com UPDATE direto no SDK — deve retornar erro de permissão pois a coluna não está no GRANT)
- [ ] Bucket `avatars`: usuário só consegue enviar para `<seu-user-id>/avatar.jpg`
