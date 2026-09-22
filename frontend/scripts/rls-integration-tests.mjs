#!/usr/bin/env node
/**
 * Planeje — Testes de integração de RLS/autorização contra um Supabase real
 * ===========================================================================
 * NÃO EXECUTADO nesta auditoria — precisa de um projeto Supabase de
 * homologação (schema + policies já aplicados) e de credenciais que não
 * estão disponíveis neste ambiente. Escrito pra rodar quando esse ambiente
 * existir, seja manualmente, seja num pipeline de CI com secrets configurados.
 *
 * NUNCA aponte isto para o Supabase de PRODUÇÃO do Planeje. Use um projeto
 * Supabase separado (gratuito) com o mesmo schema/RLS aplicado, e contas de
 * teste fictícias criadas só para isso.
 *
 * Variáveis de ambiente esperadas (todas do projeto de HOMOLOGAÇÃO):
 *   STAGING_SUPABASE_URL
 *   STAGING_SUPABASE_ANON_KEY
 *   TEST_USER_A_EMAIL / TEST_USER_A_PASSWORD   (conta fictícia A)
 *   TEST_USER_B_EMAIL / TEST_USER_B_PASSWORD   (conta fictícia B)
 *
 * Uso:
 *   STAGING_SUPABASE_URL=... STAGING_SUPABASE_ANON_KEY=... \
 *   TEST_USER_A_EMAIL=... TEST_USER_A_PASSWORD=... \
 *   TEST_USER_B_EMAIL=... TEST_USER_B_PASSWORD=... \
 *   node scripts/rls-integration-tests.mjs
 *
 * Cobre o item A do checklist ("Autorização e RLS") e parte do B/C que
 * dependem de um Postgres real com as policies aplicadas — algo que testes
 * unitários com mocks (src/__tests__/) não conseguem verificar de verdade.
 */
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = [
  'STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY',
  'TEST_USER_A_EMAIL', 'TEST_USER_A_PASSWORD',
  'TEST_USER_B_EMAIL', 'TEST_USER_B_PASSWORD',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`[rls-integration-tests] Variáveis de ambiente faltando: ${missing.join(', ')}`);
  console.error('[rls-integration-tests] NÃO EXECUTADO — precisa de um projeto Supabase de homologação. Ver comentário no topo deste arquivo.');
  process.exit(2);
}

const url = process.env.STAGING_SUPABASE_URL;
const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;

// Trava de segurança extra: nunca deixa isto rodar apontado pro domínio de
// produção, mesmo que alguém exporte a variável errada por engano.
if (/planejeapp|xvvzr|production/i.test(url)) {
  console.error('[rls-integration-tests] ABORTADO — a URL parece ser de PRODUÇÃO. Use um projeto de homologação separado.');
  process.exit(2);
}

let falhas = 0;
function checar(nome, condicao, detalhe = '') {
  if (condicao) {
    console.log(`  ✅ ${nome}`);
  } else {
    console.error(`  ❌ ${nome}${detalhe ? ' — ' + detalhe : ''}`);
    falhas++;
  }
}

async function login(email, password) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login falhou para ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

async function main() {
  console.log('=== A. Autorização e RLS ===');

  const anon = createClient(url, anonKey);
  const a = await login(process.env.TEST_USER_A_EMAIL, process.env.TEST_USER_A_PASSWORD);
  const b = await login(process.env.TEST_USER_B_EMAIL, process.env.TEST_USER_B_PASSWORD);

  // 1) Usuário anônimo não lê dados privados
  {
    const { data, error } = await anon.from('user_data').select('*').limit(1);
    checar('1. Anônimo não lê user_data', (data?.length ?? 0) === 0 || !!error);
  }

  // 2) Usuário A não consegue LER a linha de B em user_data
  {
    const { data } = await a.client.from('user_data').select('*').eq('user_id', b.userId);
    checar('2. Usuário A não lê user_data de B', (data?.length ?? 0) === 0);
  }

  // 3) Usuário A não consegue ESCREVER na linha de B
  {
    const { error } = await a.client.from('user_data')
      .update({ data: { financeiro_dividas: '[]' } }).eq('user_id', b.userId);
    // Sucesso do teste = OU deu erro, OU não afetou nenhuma linha (RLS silenciosa)
    const { count } = await a.client.from('user_data').select('user_id', { count: 'exact', head: true }).eq('user_id', b.userId);
    checar('3. Usuário A não escreve em user_data de B', !!error || (count ?? 0) === 0);
  }

  // 4) Usuário A não consegue ler/alterar o perfil de B
  {
    const { data } = await a.client.from('perfis').select('*').eq('id', b.userId);
    checar('4. Usuário A não lê perfis de B', (data?.length ?? 0) === 0);
  }

  // 5) Usuário A não consegue se autopromover a plano='liberado' (paywall)
  {
    const { error } = await a.client.from('perfis').update({ plano: 'liberado' }).eq('id', a.userId);
    checar('5. Cliente não altera coluna "plano" do próprio perfil (bloqueado por GRANT de coluna)', !!error, error?.message);
  }

  // 6) Usuário A não executa função administrativa (rate_limit_hit)
  {
    const { error } = await a.client.rpc('rate_limit_hit', { p_key: 'teste', p_window_ms: 1000, p_limit: 1 });
    checar('6. Cliente não executa rate_limit_hit (só service_role)', !!error, error?.message);
  }

  // 7) Upload de avatar: arquivo não-imagem/grande é rejeitado pelo bucket
  {
    const arquivoFalso = new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'text/html' });
    const { error } = await a.client.storage.from('avatars').upload(`${a.userId}/teste-seguranca.html`, arquivoFalso, { upsert: true });
    checar('7. Bucket avatars rejeita arquivo não-imagem/grande', !!error, error?.message);
    // limpeza best-effort — não falha o teste se der erro (já era pra não existir)
    await a.client.storage.from('avatars').remove([`${a.userId}/teste-seguranca.html`]).catch(() => {});
  }

  console.log('\n=== B. Autenticação (parcial — o que dá pra testar via client) ===');

  // 8) Logout revoga a sessão local (chamadas seguintes falham)
  {
    await a.client.auth.signOut();
    const { data } = await a.client.from('user_data').select('*').limit(1);
    checar('8. Após logout, sessão não lê mais dados privados', (data?.length ?? 0) === 0);
  }

  console.log(`\n${falhas === 0 ? 'TODOS OS TESTES PASSARAM' : `${falhas} TESTE(S) FALHARAM`}`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('[rls-integration-tests] erro fatal:', err.message);
  process.exit(2);
});
