/**
 * Planeje — API Security Tests
 * Framework: Vitest (mesmo padrão de security.test.js / resilience.test.js)
 *
 * Testa as rotas serverless de api/*.js IMPORTANDO o código real de produção,
 * com @supabase/supabase-js e stripe mockados (nenhuma chamada de rede real,
 * nenhum dado real tocado, nenhuma credencial necessária).
 *
 * Cobertura (mapeada ao checklist da auditoria de 22/09/2026):
 *  B. Autenticação
 *   1. checkOrigin — rejeita requisição sem header Origin
 *   2. checkOrigin — rejeita origem fora da allowlist
 *   3. checkOrigin — aceita origem oficial do Planeje
 *   4. requireAuthUser — rejeita sem Authorization header (sessão ausente)
 *   5. requireAuthUser — rejeita quando Supabase invalida o token (sessão expirada/revogada)
 *   6. requireAuthUser — aceita token válido e retorna o usuário
 *   7. rateLimit (fallback em memória) — bloqueia após o limite na mesma chave/IP
 *   8. rateLimit (fallback em memória) — chaves diferentes não interferem entre si
 *   9. monitor-data — fail-closed: SEM CRON_SECRET, nenhuma chamada é aceita
 *  10. monitor-data — fail-closed: CRON_SECRET curto (<16 chars) também nega
 *  11. monitor-data — token errado é rejeitado mesmo com CRON_SECRET forte configurado
 *  12. monitor-data — token correto é aceito
 *  13. WebAuthn — consumeChallenge nega challenge mais velho que o TTL (5min)
 *  14. WebAuthn — consumeChallenge nega reuso (challenge já consumido não existe mais)
 *  15. WebAuthn — login-verify nega credencial cuja conta foi excluída/e-mail reaproveitado
 *
 *  C. Pagamentos
 *  16. Webhook Stripe — sem header stripe-signature → 400 (rejeitado antes de tocar o banco)
 *  17. Webhook Stripe — assinatura inválida (constructEvent lança) → 400, banco nunca é chamado
 *  18. Webhook Stripe — checkout.session.completed grava plano/assinatura/ids do Stripe
 *  19. Webhook Stripe — reprocessar o MESMO evento não gera efeito colateral adicional
 *      (idempotência natural do UPDATE — mesmo payload, mesmo resultado final)
 *  20. Webhook Stripe — [FALHA CONFIRMADA] evento desatualizado (fora de ordem) reativa
 *      uma assinatura já cancelada por um evento mais recente. Ver relatório da
 *      auditoria para a correção proposta (guarda por timestamp do evento).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de @supabase/supabase-js — controlado por teste via `__setSupabaseMock`.
// ---------------------------------------------------------------------------
const supabaseState = { impl: null };

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => supabaseState.impl(),
}));

// Mock de stripe — controlado por teste via `__setStripeMock`.
const stripeState = { impl: null };
vi.mock('stripe', () => ({
  default: class {
    // `webhooks` é um getter (não um campo fixado no construtor) para que
    // testes que trocam stripeState.impl NO MEIO do teste (simulando dois
    // eventos chegando em sequência) afetem também chamadas feitas com a
    // MESMA instância de `stripe` já construída no módulo (module-level).
    get webhooks() { return stripeState.impl().webhooks; }
  },
}));

function makeRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn((payload) => { res.body = payload; return res; });
  res.send = vi.fn((payload) => { res.body = payload; return res; });
  res.end = vi.fn(() => res);
  return res;
}

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
  supabaseState.impl = null;
  stripeState.impl = null;
});

// ===========================================================================
// checkOrigin / requireAuthUser / rateLimit — api/_security.js
// ===========================================================================
describe('_security.js — checkOrigin', () => {
  it('1. Sem header Origin → 403, não autoriza', async () => {
    supabaseState.impl = () => ({});
    const { checkOrigin } = await import('../../api/_security.js');
    const res = makeRes();
    const ok = checkOrigin({ headers: {} }, res);
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('2. Origin fora da allowlist → 403', async () => {
    supabaseState.impl = () => ({});
    const { checkOrigin } = await import('../../api/_security.js');
    const res = makeRes();
    const ok = checkOrigin({ headers: { origin: 'https://evil.example' } }, res);
    expect(ok).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it('3. Origin oficial do Planeje → autorizado, res não é tocado', async () => {
    supabaseState.impl = () => ({});
    const { checkOrigin } = await import('../../api/_security.js');
    const res = makeRes();
    const ok = checkOrigin({ headers: { origin: 'https://www.planejeapp.com.br' } }, res);
    expect(ok).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('_security.js — requireAuthUser', () => {
  it('4. Sem Authorization header → 401, sessão ausente é tratada como não autenticado', async () => {
    supabaseState.impl = () => ({ auth: { getUser: vi.fn() } });
    const { requireAuthUser } = await import('../../api/_security.js');
    const res = makeRes();
    const user = await requireAuthUser({ headers: {} }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('5. Token inválido/expirado (Supabase retorna erro) → 401', async () => {
    supabaseState.impl = () => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: null, error: new Error('invalid token') }) },
    });
    const { requireAuthUser } = await import('../../api/_security.js');
    const res = makeRes();
    const user = await requireAuthUser({ headers: { authorization: 'Bearer token-velho' } }, res);
    expect(user).toBeNull();
    expect(res.statusCode).toBe(401);
  });

  it('6. Token válido → retorna o usuário, res não é tocado', async () => {
    const fakeUser = { id: 'user-a', email: 'a@example.com' };
    supabaseState.impl = () => ({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: fakeUser }, error: null }) },
    });
    const { requireAuthUser } = await import('../../api/_security.js');
    const res = makeRes();
    const user = await requireAuthUser({ headers: { authorization: 'Bearer token-bom' } }, res);
    expect(user).toEqual(fakeUser);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('_security.js — rateLimit (fallback em memória)', () => {
  // Força o caminho de fallback: supabase.rpc sempre falha, então rateLimit()
  // usa o Map em memória (mesmo comportamento de quando rate_limit_hit() ainda
  // não existe no banco, ou o banco está fora do ar).
  function supabaseSempreFalha() {
    return { rpc: vi.fn().mockRejectedValue(new Error('rpc indisponível')) };
  }

  it('7. Bloqueia a Nª+1 requisição da mesma chave dentro da janela', async () => {
    supabaseState.impl = supabaseSempreFalha;
    const { rateLimit } = await import('../../api/_security.js');
    const req = { headers: { 'x-forwarded-for': '203.0.113.9' } };
    const opts = { key: 'teste-limite', limit: 3, windowMs: 60_000 };

    for (let i = 0; i < 3; i++) {
      const res = makeRes();
      const ok = await rateLimit(req, res, opts);
      expect(ok).toBe(true);
    }
    const res4 = makeRes();
    const ok4 = await rateLimit(req, res4, opts);
    expect(ok4).toBe(false);
    expect(res4.statusCode).toBe(429);
  });

  it('8. IPs/chaves diferentes têm contadores independentes', async () => {
    supabaseState.impl = supabaseSempreFalha;
    const { rateLimit } = await import('../../api/_security.js');
    const opts = { key: 'teste-isolamento', limit: 1, windowMs: 60_000 };

    const resA1 = makeRes();
    expect(await rateLimit({ headers: { 'x-forwarded-for': '10.0.0.1' } }, resA1, opts)).toBe(true);
    const resA2 = makeRes();
    expect(await rateLimit({ headers: { 'x-forwarded-for': '10.0.0.1' } }, resA2, opts)).toBe(false);

    // IP diferente não deve estar bloqueado pelo consumo do IP anterior
    const resB1 = makeRes();
    expect(await rateLimit({ headers: { 'x-forwarded-for': '10.0.0.2' } }, resB1, opts)).toBe(true);
  });
});

// ===========================================================================
// monitor-data.js — cron fail-closed
// ===========================================================================
describe('monitor-data.js — autenticação do cron (fail-closed)', () => {
  function supabaseComRpcVazio() {
    return { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) };
  }

  it('9. Sem CRON_SECRET configurado → nega mesmo sem token', async () => {
    delete process.env.CRON_SECRET;
    supabaseState.impl = supabaseComRpcVazio;
    const { default: handler } = await import('../../api/monitor-data.js');
    const res = makeRes();
    await handler({ headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });

  it('10. CRON_SECRET curto (<16 chars) → nega mesmo com o valor exato', async () => {
    process.env.CRON_SECRET = 'curto123';
    supabaseState.impl = supabaseComRpcVazio;
    const { default: handler } = await import('../../api/monitor-data.js');
    const res = makeRes();
    await handler({ headers: { authorization: 'Bearer curto123' } }, res);
    expect(res.statusCode).toBe(401);
  });

  it('11. CRON_SECRET forte configurado, token errado → 401', async () => {
    process.env.CRON_SECRET = 'a'.repeat(32);
    supabaseState.impl = supabaseComRpcVazio;
    const { default: handler } = await import('../../api/monitor-data.js');
    const res = makeRes();
    await handler({ headers: { authorization: 'Bearer token-errado-tambem-longo-o-suficiente' } }, res);
    expect(res.statusCode).toBe(401);
  });

  it('12. CRON_SECRET forte configurado, token correto → processa (200)', async () => {
    process.env.CRON_SECRET = 'a'.repeat(32);
    supabaseState.impl = supabaseComRpcVazio;
    const { default: handler } = await import('../../api/monitor-data.js');
    const res = makeRes();
    await handler({ headers: { authorization: `Bearer ${'a'.repeat(32)}` } }, res);
    expect(res.statusCode).toBe(200);
  });
});

// ===========================================================================
// _webauthn.js — TTL e reuso de challenge
// ===========================================================================
describe('_webauthn.js — consumeChallenge', () => {
  it('13. Challenge mais velho que 5 minutos é rejeitado (retorna null)', async () => {
    const seisMinAtras = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    supabaseState.impl = () => ({
      from: () => ({
        delete: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: 'c1', challenge: 'abc', created_at: seisMinAtras }, error: null,
        }),
      }),
    });
    const { consumeChallenge } = await import('../../api/_webauthn.js');
    const result = await consumeChallenge('teste@example.com');
    expect(result).toBeNull();
  });

  it('14. Challenge já consumido (não existe mais na tabela) → null (nega reuso)', async () => {
    supabaseState.impl = () => ({
      from: () => ({
        delete: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    });
    const { consumeChallenge } = await import('../../api/_webauthn.js');
    const result = await consumeChallenge('teste@example.com');
    expect(result).toBeNull();
  });
});

describe('webauthn-login-verify.js — credencial órfã (conta excluída/e-mail reaproveitado)', () => {
  it('15. E-mail do dono atual da credencial não bate com o e-mail do login → 401', async () => {
    process.env.CRON_SECRET = 'a'.repeat(32);
    vi.doMock('@simplewebauthn/server', () => ({
      verifyAuthenticationResponse: vi.fn(),
    }));

    const credFromDb = { id: 'cred1', user_id: 'user-antigo', public_key: 'a2V5', counter: 0 };
    supabaseState.impl = () => ({
      from: (table) => {
        if (table === 'webauthn_challenges') {
          return {
            delete: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 'c1', challenge: 'abc', created_at: new Date().toISOString() }, error: null,
            }),
          };
        }
        if (table === 'webauthn_credentials') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: credFromDb, error: null }),
          };
        }
        return {};
      },
      auth: {
        admin: {
          // Conta ainda existe, mas o e-mail dela hoje é outro (foi reaproveitado
          // por uma pessoa diferente após a conta original ser excluída).
          getUserById: vi.fn().mockResolvedValue({ data: { user: { email: 'dono-novo@example.com' } }, error: null }),
        },
      },
    });

    const { default: handler } = await import('../../api/webauthn-login-verify.js');
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { origin: 'https://www.planejeapp.com.br' },
      body: { email: 'teste@example.com', assertionResponse: { id: 'cred1' } },
    }, res);

    expect(res.statusCode).toBe(401);
  });
});

// ===========================================================================
// stripe-webhook.js — validação de assinatura, gravação e (falta de) ordenação
// ===========================================================================
describe('stripe-webhook.js', () => {
  // .eq(...) sozinho (branch checkout.session.completed) e .eq(...).or(...)
  // (branch de assinatura, com a guarda de ordenação) precisam funcionar —
  // por isso o builder é ao mesmo tempo "then-ável" e tem um método .or().
  function supabaseCapturaUpdates() {
    const calls = [];
    return {
      client: {
        from: (table) => ({
          update: (payload) => {
            calls.push({ table, payload });
            return {
              eq: () => ({
                or: () => Promise.resolve({ error: null }),
                then: (resolve) => resolve({ error: null }),
              }),
            };
          },
        }),
      },
      calls,
    };
  }

  // Simula, só pra coluna stripe_last_event_at, o comportamento real do
  // Postgres com o filtro .or('col.is.null,col.lt.<ts>') — permite testar a
  // guarda de ordenação de verdade (não só a "forma" da query).
  function supabaseComGuardaDeOrdenacao() {
    const rows = new Map(); // stripe_subscription_id -> { assinatura_status, stripe_last_event_at }
    const calls = [];
    return {
      client: {
        from: () => ({
          update: (payload) => ({
            eq: (_col, subId) => ({
              or: (filterStr) => {
                const row = rows.get(subId) || { stripe_last_event_at: null };
                const limiar = filterStr.match(/stripe_last_event_at\.lt\.([^,]+)/)?.[1] ?? null;
                const passa = row.stripe_last_event_at == null || (limiar !== null && row.stripe_last_event_at < limiar);
                if (passa) rows.set(subId, { ...row, ...payload });
                calls.push({ subId, payload, aplicado: passa });
                return Promise.resolve({ error: null });
              },
            }),
          }),
        }),
      },
      rows,
      calls,
    };
  }

  function reqComBody(bodyStr) {
    const { Readable } = require('stream');
    const r = Readable.from([Buffer.from(bodyStr)]);
    r.method = 'POST';
    r.headers = { 'stripe-signature': 'sig-qualquer' };
    return r;
  }

  it('16. Sem header stripe-signature → 400, banco nunca é consultado', async () => {
    stripeState.impl = () => ({ webhooks: { constructEvent: vi.fn() } });
    const { client } = supabaseCapturaUpdates();
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');
    const res = makeRes();
    const req = reqComBody('{}');
    req.headers = {};
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('17. Assinatura inválida (constructEvent lança) → 400, banco nunca é tocado', async () => {
    const { client, calls } = supabaseCapturaUpdates();
    supabaseState.impl = () => client;
    stripeState.impl = () => ({
      webhooks: { constructEvent: vi.fn(() => { throw new Error('assinatura inválida'); }) },
    });
    const { default: handler } = await import('../../api/stripe-webhook.js');
    const res = makeRes();
    await handler(reqComBody('{}'), res);
    expect(res.statusCode).toBe(400);
    expect(calls.length).toBe(0);
  });

  it('18. checkout.session.completed grava plano/assinatura/ids — nenhum outro campo', async () => {
    const { client, calls } = supabaseCapturaUpdates();
    supabaseState.impl = () => client;
    const event = {
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: 'user-123', customer: 'cus_1', subscription: 'sub_1' } },
    };
    stripeState.impl = () => ({ webhooks: { constructEvent: vi.fn(() => event) } });
    const { default: handler } = await import('../../api/stripe-webhook.js');
    const res = makeRes();
    await handler(reqComBody('{}'), res);

    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('perfis');
    expect(Object.keys(calls[0].payload).sort()).toEqual(
      ['assinatura_status', 'plano', 'stripe_customer_id', 'stripe_subscription_id'].sort()
    );
    expect(calls[0].payload.plano).toBe('pago');
  });

  it('19. Reprocessar o mesmo evento não altera o resultado final (idempotente)', async () => {
    const { client, calls } = supabaseCapturaUpdates();
    supabaseState.impl = () => client;
    const event = {
      type: 'customer.subscription.updated',
      created: 1000,
      data: { object: { id: 'sub_1', status: 'active' } },
    };
    stripeState.impl = () => ({ webhooks: { constructEvent: vi.fn(() => event) } });
    const { default: handler } = await import('../../api/stripe-webhook.js');

    await handler(reqComBody('{}'), makeRes());
    await handler(reqComBody('{}'), makeRes());

    expect(calls).toHaveLength(2);
    expect(calls[0].payload).toEqual(calls[1].payload); // mesmo efeito, sem duplicar linhas
  });

  it('20. Evento desatualizado (fora de ordem) NÃO reativa assinatura já cancelada', async () => {
    // Cenário: Stripe entrega "canceled" primeiro (processado), depois entrega
    // (atrasado/reentregue) o "active" de ANTES do cancelamento. A guarda por
    // stripe_last_event_at (frontend/supabase/webhook_ordering_guard.sql +
    // api/stripe-webhook.js) deve ignorar o evento antigo.
    //
    // ANTES da correção, este teste falhava (a asserção final batia 'ativa').
    // Ver histórico do commit para o comportamento inseguro documentado.
    const { client, rows } = supabaseComGuardaDeOrdenacao();
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');

    const eventoCancelamento = {
      type: 'customer.subscription.deleted',
      created: 2000,
      data: { object: { id: 'sub_1', status: 'canceled' } },
    };
    const eventoAntigoAtrasado = {
      type: 'customer.subscription.updated',
      created: 1000, // MAIS ANTIGO que o cancelamento, mas chega DEPOIS
      data: { object: { id: 'sub_1', status: 'active' } },
    };

    stripeState.impl = () => ({ webhooks: { constructEvent: vi.fn(() => eventoCancelamento) } });
    await handler(reqComBody('{}'), makeRes());
    expect(rows.get('sub_1').assinatura_status).toBe('inativa');

    stripeState.impl = () => ({ webhooks: { constructEvent: vi.fn(() => eventoAntigoAtrasado) } });
    await handler(reqComBody('{}'), makeRes());

    expect(rows.get('sub_1').assinatura_status).toBe('inativa');
  });
});
