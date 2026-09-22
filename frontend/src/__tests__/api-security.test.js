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
 *  19. Webhook Stripe — evento já processado com sucesso (event.id repetido) é ignorado:
 *      responde 200 duplicate, NÃO toca 'perfis' de novo
 *  20. Webhook Stripe — evento desatualizado (fora de ordem) NÃO reativa assinatura já
 *      cancelada (guarda por timestamp, stripe_last_event_at)
 *  21. Webhook Stripe — dois eventos legítimos com o MESMO timestamp (empate) — o
 *      segundo não é descartado indevidamente (guarda usa <=, não <)
 *  22. Webhook Stripe — consulta o estado ATUAL da assinatura na API da Stripe em vez
 *      de confiar cegamente no snapshot do payload do evento
 *  23. Webhook Stripe — [3ª rodada] se a consulta à Stripe falhar, NÃO usa o status do
 *      payload como melhor esforço — devolve erro retryable (503) e desfaz a
 *      reivindicação do evento, sem alterar 'perfis'
 *  24. Webhook Stripe — [3ª rodada] duas entregas SIMULTÂNEAS do mesmo event.id: a
 *      reivindicação via INSERT (chave primária) garante que só uma processa; a
 *      outra recebe 409 (retry), e 'perfis' é tocado exatamente uma vez
 *  25. Webhook Stripe — [3ª rodada] uma reivindicação "processing" travada (tentativa
 *      anterior que morreu no meio) é retomada depois de CLAIM_STALE_MS e processada
 *
 *  [4ª rodada — revisão do fencing token entre tentativas de claimEvent()]
 *  26. Tentativa A atrasada (não morta) NÃO sobrescreve o "completed" já gravado por B
 *  27. Falha de A depois que B assumiu NÃO apaga a reivindicação de B
 *  28. Duas retomadas SIMULTÂNEAS da mesma reivindicação travada — só uma vence
 *  29. Execuções sobrepostas (A conclui E falha, nesta ordem, depois de B) não corrompem
 *      o registro final de B
 *  30. Diferencia "já concluído" (duplicata) de "ainda em processamento" (concorrente)
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
    // `webhooks`/`subscriptions` são getters (não campos fixados no
    // construtor) para que testes que trocam stripeState.impl NO MEIO do
    // teste (simulando dois eventos chegando em sequência) afetem também
    // chamadas feitas com a MESMA instância de `stripe` já construída no
    // módulo (module-level).
    get webhooks() { return stripeState.impl().webhooks; }
    get subscriptions() { return stripeState.impl().subscriptions; }
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
  // Mock único e compartilhado das duas tabelas que o handler toca:
  //  - perfis: .eq('id', ...) sozinho (branch checkout) e
  //    .eq('stripe_subscription_id', ...).or(...) (branch de assinatura, com
  //    simulação real do filtro de ordenação).
  //  - stripe_processed_events: reivindicação atômica por event.id — o
  //    insert() simula o comportamento real do Postgres com PRIMARY KEY
  //    (conflito de chave = erro 23505), o que permite testar concorrência
  //    de verdade, não só a "forma" da query.
  function fakeSupabase({ ordering = false } = {}) {
    const rows = new Map();            // stripe_subscription_id -> row simulada (perfis)
    const calls = [];                  // updates em 'perfis'
    const processedEvents = new Map(); // event_id -> { type, status, processed_at }

    function perfisUpdate(payload) {
      return {
        eq: (col, val) => {
          if (col !== 'stripe_subscription_id') {
            calls.push({ table: 'perfis', payload });
            return { then: (resolve) => resolve({ error: null }) };
          }
          return {
            or: (filterStr) => {
              if (!ordering) {
                calls.push({ table: 'perfis', payload });
                return Promise.resolve({ error: null });
              }
              const row = rows.get(val) || { stripe_last_event_at: null };
              const limiar = filterStr.match(/stripe_last_event_at\.lte\.([^,]+)/)?.[1] ?? null;
              const passa = row.stripe_last_event_at == null || (limiar !== null && row.stripe_last_event_at <= limiar);
              if (passa) rows.set(val, { ...row, ...payload });
              calls.push({ subId: val, payload, aplicado: passa });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    }

    // Confere TODOS os filtros .eq() acumulados (exceto event_id, que é a
    // chave de busca) contra a linha atual — simula um WHERE col=val AND
    // col2=val2 real do Postgres, inclusive pro fencing token (attempt_id).
    function linhaBateComFiltros(row, filters) {
      if (!row) return false;
      for (const [key, val] of Object.entries(filters)) {
        if (key === 'event_id') continue;
        if (row[key] !== val) return false;
      }
      return true;
    }

    function processedEventsTable() {
      return {
        insert: (row) => {
          if (processedEvents.has(row.event_id)) {
            return Promise.resolve({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
          }
          processedEvents.set(row.event_id, {
            type: row.type, status: row.status, attempt_id: row.attempt_id,
            processed_at: new Date().toISOString(),
          });
          return Promise.resolve({ error: null });
        },
        select: () => ({
          eq: (_col, eventId) => ({
            maybeSingle: () => {
              const row = processedEvents.get(eventId);
              return Promise.resolve({
                data: row ? { status: row.status, processed_at: row.processed_at, attempt_id: row.attempt_id } : null,
                error: null,
              });
            },
          }),
        }),
        update: (payload) => {
          const filters = {};
          const builder = {
            eq: (col, val) => { filters[col] = val; return builder; },
            select: () => {
              const row = processedEvents.get(filters.event_id);
              if (!linhaBateComFiltros(row, filters)) return Promise.resolve({ data: [], error: null });
              Object.assign(row, payload);
              return Promise.resolve({ data: [{ event_id: filters.event_id }], error: null });
            },
            then: (resolve) => {
              const row = processedEvents.get(filters.event_id);
              if (linhaBateComFiltros(row, filters)) Object.assign(row, payload);
              resolve({ error: null });
            },
          };
          return builder;
        },
        delete: () => {
          const filters = {};
          const builder = {
            eq: (col, val) => { filters[col] = val; return builder; },
            then: (resolve) => {
              const row = processedEvents.get(filters.event_id);
              if (linhaBateComFiltros(row, filters)) processedEvents.delete(filters.event_id);
              resolve({ error: null });
            },
          };
          return builder;
        },
      };
    }

    const client = {
      from: (table) => {
        if (table === 'perfis') return { update: perfisUpdate };
        if (table === 'stripe_processed_events') return processedEventsTable();
        return {};
      },
    };

    return { client, calls, rows, processedEvents };
  }

  function reqComBody(bodyStr) {
    const { Readable } = require('stream');
    const r = Readable.from([Buffer.from(bodyStr)]);
    r.method = 'POST';
    r.headers = { 'stripe-signature': 'sig-qualquer' };
    return r;
  }

  // Por padrão, stripe.subscriptions.retrieve() espelha o status já embutido
  // no payload do evento — assim os testes que não são especificamente sobre
  // a consulta à Stripe continuam comparáveis entre si. O teste 22 e 23
  // sobrescrevem isto de propósito.
  function stripeComEvento(event, { subscriptionsRetrieve } = {}) {
    return {
      webhooks: { constructEvent: vi.fn(() => event) },
      subscriptions: {
        retrieve: subscriptionsRetrieve || vi.fn(async () => ({ status: event.data?.object?.status })),
      },
    };
  }

  it('16. Sem header stripe-signature → 400, banco nunca é consultado', async () => {
    stripeState.impl = () => ({ webhooks: { constructEvent: vi.fn() } });
    const { client } = fakeSupabase();
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');
    const res = makeRes();
    const req = reqComBody('{}');
    req.headers = {};
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('17. Assinatura inválida (constructEvent lança) → 400, banco nunca é tocado', async () => {
    const { client, calls } = fakeSupabase();
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
    const { client, calls } = fakeSupabase();
    supabaseState.impl = () => client;
    const event = {
      id: 'evt_18',
      type: 'checkout.session.completed',
      created: 1000,
      data: { object: { client_reference_id: 'user-123', customer: 'cus_1', subscription: 'sub_1' } },
    };
    stripeState.impl = () => stripeComEvento(event);
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

  it('19. Evento já processado com sucesso (event.id repetido) é ignorado', async () => {
    const { client, calls, processedEvents } = fakeSupabase();
    supabaseState.impl = () => client;
    const event = {
      id: 'evt_19_repetido',
      type: 'customer.subscription.updated',
      created: 1000,
      data: { object: { id: 'sub_1', status: 'active' } },
    };
    stripeState.impl = () => stripeComEvento(event);
    const { default: handler } = await import('../../api/stripe-webhook.js');

    const res1 = makeRes();
    await handler(reqComBody('{}'), res1);
    expect(res1.statusCode).toBe(200);
    expect(processedEvents.get('evt_19_repetido').status).toBe('completed');

    const res2 = makeRes();
    await handler(reqComBody('{}'), res2);

    expect(calls).toHaveLength(1); // só a PRIMEIRA entrega tocou o banco
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toMatchObject({ duplicate: true });
  });

  it('20. Evento desatualizado (fora de ordem) NÃO reativa assinatura já cancelada', async () => {
    const { client, rows } = fakeSupabase({ ordering: true });
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');

    const eventoCancelamento = {
      id: 'evt_20_cancel',
      type: 'customer.subscription.deleted',
      created: 2000,
      data: { object: { id: 'sub_1', status: 'canceled' } },
    };
    const eventoAntigoAtrasado = {
      id: 'evt_20_atrasado',
      type: 'customer.subscription.updated',
      created: 1000, // MAIS ANTIGO que o cancelamento, mas chega DEPOIS
      data: { object: { id: 'sub_1', status: 'active' } },
    };

    stripeState.impl = () => stripeComEvento(eventoCancelamento);
    await handler(reqComBody('{}'), makeRes());
    expect(rows.get('sub_1').assinatura_status).toBe('inativa');

    stripeState.impl = () => stripeComEvento(eventoAntigoAtrasado);
    await handler(reqComBody('{}'), makeRes());

    expect(rows.get('sub_1').assinatura_status).toBe('inativa');
  });

  it('21. Dois eventos legítimos com o MESMO timestamp (empate) — o segundo NÃO é descartado', async () => {
    const { client, rows } = fakeSupabase({ ordering: true });
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');

    const primeiroEvento = {
      id: 'evt_21_a',
      type: 'customer.subscription.updated',
      created: 5000,
      data: { object: { id: 'sub_2', status: 'past_due' } },
    };
    const segundoEventoMesmoSegundo = {
      id: 'evt_21_b',
      type: 'customer.subscription.updated',
      created: 5000, // EMPATE proposital
      data: { object: { id: 'sub_2', status: 'active' } },
    };

    stripeState.impl = () => stripeComEvento(primeiroEvento);
    await handler(reqComBody('{}'), makeRes());
    expect(rows.get('sub_2').assinatura_status).toBe('inativa');

    stripeState.impl = () => stripeComEvento(segundoEventoMesmoSegundo);
    await handler(reqComBody('{}'), makeRes());
    expect(rows.get('sub_2').assinatura_status).toBe('ativa');
  });

  it('22. Consulta o estado ATUAL da assinatura na Stripe — não confia só no payload do evento', async () => {
    const { client, rows } = fakeSupabase({ ordering: true });
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');

    const eventoDesatualizadoNoPayload = {
      id: 'evt_22',
      type: 'customer.subscription.updated',
      created: 9000,
      data: { object: { id: 'sub_3', status: 'active' } }, // payload diz "active"
    };
    stripeState.impl = () => stripeComEvento(eventoDesatualizadoNoPayload, {
      subscriptionsRetrieve: vi.fn(async () => ({ status: 'canceled' })), // Stripe, agora, diz cancelada
    });

    await handler(reqComBody('{}'), makeRes());

    expect(rows.get('sub_3').assinatura_status).toBe('inativa');
  });

  it('23. Consulta à Stripe falha → NÃO usa o payload como melhor esforço; devolve erro retryable e desfaz a reivindicação', async () => {
    const { client, rows, calls, processedEvents } = fakeSupabase({ ordering: true });
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');

    const event = {
      id: 'evt_23',
      type: 'customer.subscription.updated',
      created: 9500,
      data: { object: { id: 'sub_4', status: 'active' } },
    };
    stripeState.impl = () => stripeComEvento(event, {
      subscriptionsRetrieve: vi.fn(async () => { throw new Error('Stripe indisponível'); }),
    });

    const res = makeRes();
    await handler(reqComBody('{}'), res);

    expect(res.statusCode).toBe(503); // erro retryable — Stripe reentrega mais tarde
    expect(calls).toHaveLength(0);    // 'perfis' NUNCA foi tocado
    expect(rows.has('sub_4')).toBe(false);
    // a reivindicação foi desfeita — uma reentrega real deve conseguir reprocessar:
    expect(processedEvents.has('evt_23')).toBe(false);
  });

  it('24. Duas entregas SIMULTÂNEAS do mesmo event.id — só uma processa, a outra pede retry (sem duplicar o efeito)', async () => {
    const { client, calls } = fakeSupabase({ ordering: true });
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');

    const event = {
      id: 'evt_24_concorrente',
      type: 'customer.subscription.updated',
      created: 6000,
      data: { object: { id: 'sub_5', status: 'active' } },
    };
    stripeState.impl = () => stripeComEvento(event);

    const res1 = makeRes();
    const res2 = makeRes();
    await Promise.all([
      handler(reqComBody('{}'), res1),
      handler(reqComBody('{}'), res2),
    ]);

    const statusCodes = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
    expect(statusCodes).toEqual([200, 409]); // uma processa (200), a outra pede retry (409)
    expect(calls).toHaveLength(1); // 'perfis' tocado exatamente UMA vez, não duas
  });

  it('25. Reivindicação "processing" travada (tentativa anterior morta) é retomada após CLAIM_STALE_MS', async () => {
    const { client, rows, calls, processedEvents } = fakeSupabase({ ordering: true });
    supabaseState.impl = () => client;
    const { default: handler } = await import('../../api/stripe-webhook.js');

    // Simula uma tentativa anterior que reivindicou o evento e travou (processo
    // morto/timeout) sem nunca chamar finishEvent — a linha fica "processing"
    // com processed_at bem antigo.
    processedEvents.set('evt_25_travado', {
      type: 'customer.subscription.updated',
      status: 'processing',
      processed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min atrás
    });

    const event = {
      id: 'evt_25_travado',
      type: 'customer.subscription.updated',
      created: 7000,
      data: { object: { id: 'sub_6', status: 'active' } },
    };
    stripeState.impl = () => stripeComEvento(event);

    const res = makeRes();
    await handler(reqComBody('{}'), res);

    expect(res.statusCode).toBe(200);
    expect(calls).toHaveLength(1); // desta vez processou de verdade
    expect(rows.get('sub_6').assinatura_status).toBe('ativa');
    expect(processedEvents.get('evt_25_travado').status).toBe('completed');
  });

  // =========================================================================
  // Revisão final do mecanismo de claimEvent()/finishEvent() (fencing token)
  // Testes diretos das funções internas (exportadas só pra teste) — mais
  // precisos que orquestrar timing via handler(), porque as perguntas são
  // sobre o comportamento EXATO da reivindicação/retomada, não sobre o
  // fluxo HTTP em volta delas.
  // =========================================================================
  describe('claimEvent()/finishEvent() — fencing token entre tentativas', () => {
    it('26. [Pergunta 1] Tentativa A atrasada NÃO sobrescreve o "completed" já gravado por B', async () => {
      const { client, processedEvents } = fakeSupabase();
      supabaseState.impl = () => client;
      const { claimEvent, finishEvent } = await import('../../api/stripe-webhook.js');
      const event = { id: 'evt_q1', type: 'customer.subscription.updated' };

      const claimA = await claimEvent(event); // A reivindica primeiro
      expect(claimA.ok).toBe(true);

      // Simula A "travada" há mais tempo que o limite de retomada.
      processedEvents.get('evt_q1').processed_at = new Date(Date.now() - 3 * 60 * 1000).toISOString();

      const claimB = await claimEvent(event); // B retoma
      expect(claimB.ok).toBe(true);
      expect(claimB.attemptId).not.toBe(claimA.attemptId);

      await finishEvent(event, true, claimB.attemptId); // B termina primeiro
      expect(processedEvents.get('evt_q1').status).toBe('completed');
      expect(processedEvents.get('evt_q1').attempt_id).toBe(claimB.attemptId);

      // A finalmente "acorda" (era só lenta, não morta) e tenta concluir
      // usando o token ANTIGO — isto NÃO PODE ter efeito.
      await finishEvent(event, true, claimA.attemptId);

      expect(processedEvents.get('evt_q1').status).toBe('completed');
      expect(processedEvents.get('evt_q1').attempt_id).toBe(claimB.attemptId); // continua sendo o de B
    });

    it('27. [Pergunta 2] Falha de A DEPOIS que B assumiu NÃO apaga a reivindicação de B', async () => {
      const { client, processedEvents } = fakeSupabase();
      supabaseState.impl = () => client;
      const { claimEvent, finishEvent } = await import('../../api/stripe-webhook.js');
      const event = { id: 'evt_q2', type: 'customer.subscription.updated' };

      const claimA = await claimEvent(event);
      processedEvents.get('evt_q2').processed_at = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const claimB = await claimEvent(event);
      expect(claimB.ok).toBe(true); // B assumiu; ainda está "processing" (não terminou)

      // A finalmente falha e tenta limpar a PRÓPRIA reivindicação — que já
      // não é mais dela.
      await finishEvent(event, false, claimA.attemptId);

      expect(processedEvents.has('evt_q2')).toBe(true); // a linha de B continua existindo
      expect(processedEvents.get('evt_q2').attempt_id).toBe(claimB.attemptId);
      expect(processedEvents.get('evt_q2').status).toBe('processing');
    });

    it('28. [Pergunta 3] Duas retomadas SIMULTÂNEAS da mesma reivindicação travada — só uma vence (atomicidade real)', async () => {
      const { client, processedEvents } = fakeSupabase();
      supabaseState.impl = () => client;
      const { claimEvent } = await import('../../api/stripe-webhook.js');
      const event = { id: 'evt_q3', type: 'customer.subscription.updated' };

      await claimEvent(event); // reivindicação original
      processedEvents.get('evt_q3').processed_at = new Date(Date.now() - 3 * 60 * 1000).toISOString();

      const [reclaim1, reclaim2] = await Promise.all([claimEvent(event), claimEvent(event)]);

      const vencedores = [reclaim1, reclaim2].filter(r => r.ok);
      expect(vencedores).toHaveLength(1); // exatamente UMA retomada vence
      expect(processedEvents.get('evt_q3').attempt_id).toBe(vencedores[0].attemptId);
    });

    it('29. [Pergunta 4] Execuções sobrepostas durante a retomada não deixam a linha de dedup em estado inconsistente', async () => {
      // Cobre o cenário combinado: A trava, B retoma e conclui, A (que não
      // estava realmente morta) tenta concluir e depois falhar em sequência
      // — em nenhum momento o registro final deixa de refletir o trabalho
      // de B com precisão.
      const { client, processedEvents } = fakeSupabase();
      supabaseState.impl = () => client;
      const { claimEvent, finishEvent } = await import('../../api/stripe-webhook.js');
      const event = { id: 'evt_q4', type: 'customer.subscription.updated' };

      const claimA = await claimEvent(event);
      processedEvents.get('evt_q4').processed_at = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const claimB = await claimEvent(event);
      await finishEvent(event, true, claimB.attemptId);

      // A tenta concluir E falhar depois, nesta ordem — nenhum dos dois pode
      // mexer no que já pertence a B.
      await finishEvent(event, true, claimA.attemptId);
      await finishEvent(event, false, claimA.attemptId);

      expect(processedEvents.get('evt_q4').status).toBe('completed');
      expect(processedEvents.get('evt_q4').attempt_id).toBe(claimB.attemptId);
    });

    it('30. [Pergunta 5] Diferencia corretamente "já concluído" (duplicata) de "ainda em processamento" (concorrente)', async () => {
      const { client, processedEvents } = fakeSupabase();
      supabaseState.impl = () => client;
      const { claimEvent } = await import('../../api/stripe-webhook.js');

      // Caso 1: evento já 'completed' → duplicata legítima.
      const eventoConcluido = { id: 'evt_q5_completo', type: 'customer.subscription.updated' };
      const claim1 = await claimEvent(eventoConcluido);
      // marca como concluído diretamente (simula processamento anterior bem-sucedido)
      processedEvents.get('evt_q5_completo').status = 'completed';
      const tentativaDuplicata = await claimEvent(eventoConcluido);
      expect(tentativaDuplicata).toEqual({ ok: false, reason: 'duplicate' });

      // Caso 2: evento ainda 'processing' e RECENTE → concorrência real, não duplicata.
      const eventoEmAndamento = { id: 'evt_q5_processando', type: 'customer.subscription.updated' };
      await claimEvent(eventoEmAndamento); // fica 'processing', processed_at = agora
      const tentativaConcorrente = await claimEvent(eventoEmAndamento);
      expect(tentativaConcorrente).toEqual({ ok: false, reason: 'concurrent' });

      // Os dois motivos são distintos — o código não trata "em andamento" como duplicata.
      expect(tentativaDuplicata.reason).not.toBe(tentativaConcorrente.reason);
    });
  });
});
