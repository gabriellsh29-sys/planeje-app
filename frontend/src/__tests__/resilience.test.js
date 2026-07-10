/**
 * Planeje — Resilience Tests
 * Framework: Vitest
 *
 * Testa os cenários de falha de cloudSync.js IMPORTANDO o código real de produção.
 * O Supabase é mockado; um DOM/localStorage mínimo é instalado no globalThis via
 * vi.hoisted (roda ANTES dos imports estáticos, para o módulo enxergar os globais
 * na inicialização). jsdom não está disponível no projeto, então usamos stubs enxutos.
 *
 * Cobertura (STEP 4 do briefing):
 *  1. QuotaExceededError → erro logado + evento planeje-storage-full
 *  2. JSON corrompido em mergeKey → fallback válido
 *  3. JSON corrompido em cloudVal → demais chaves continuam sendo processadas
 *  4. withRetry: falha 2x e sucede → sucesso + 2 retries logados
 *  5. withRetry: sempre falha → erro propagado após maxAttempts
 *  6. withTimeout: promise 200ms, timeout 100ms → erro de timeout
 *  7. withTimeout: promise 50ms, timeout 100ms → resolve normal
 *  8. Realtime disconnect: CHANNEL_ERROR → reconexão agendada
 *  9. Push ao ocultar: visibilitychange hidden → lightPushToCloud (upsert) chamado
 * 10. localStorage indisponível: acesso lança no import → fallback gracioso
 * 11. 401 → planeje-auth-expired despachado
 * 12. 403 → sem retry, erro logado, planeje-sync-error despachado
 * 13. Conflito mesmo timestamp em mergeKey → nuvem vence
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Instala DOM/localStorage mínimos no globalThis ANTES dos imports do módulo.
// ---------------------------------------------------------------------------
const H = vi.hoisted(() => {
  function makeEmitter() {
    const listeners = {};
    return {
      _listeners: listeners,
      addEventListener(type, fn) { (listeners[type] ||= new Set()).add(fn); },
      removeEventListener(type, fn) { listeners[type]?.delete(fn); },
      dispatchEvent(evt) { (listeners[evt.type] ? [...listeners[evt.type]] : []).forEach(fn => fn(evt)); return true; },
    };
  }
  function makeMemLS(initial = {}) {
    const store = { ...initial };
    return {
      _store: store,
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    };
  }

  const win = makeEmitter();
  const doc = makeEmitter();
  doc.visibilityState = 'visible';

  globalThis.window = win;
  globalThis.document = doc;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
  globalThis.BroadcastChannel = class BroadcastChannel {
    constructor() {} postMessage() {} close() {} set onmessage(_) {}
  };
  globalThis.localStorage = makeMemLS();

  return { makeMemLS };
});

// ---------------------------------------------------------------------------
// Mock stateful do Supabase.
// ---------------------------------------------------------------------------
const SB = vi.hoisted(() => {
  const state = {
    upserts: [],
    selectResult: { data: null, error: null },
    upsertResult: { error: null },
    systemHandler: null,
    pgHandler: null,
    removed: 0,
    refreshCalls: 0,
  };
  const thenable = (getResult) => ({ then: (res, rej) => Promise.resolve(getResult()).then(res, rej) });
  const makeQuery = () => {
    const q = {};
    const chain = () => q;
    ['select', 'eq', 'order', 'in', 'delete', 'insert'].forEach(k => { q[k] = chain; });
    q.upsert = (payload) => { state.upserts.push(payload); return thenable(() => state.upsertResult); };
    q.maybeSingle = () => thenable(() => state.selectResult);
    q.then = (res, rej) => Promise.resolve(state.selectResult).then(res, rej);
    return q;
  };
  const supabase = {
    from: () => makeQuery(),
    channel: () => {
      const ch = {};
      ch.on = (evt, arg2, handler) => {
        if (evt === 'system') state.systemHandler = handler;
        else state.pgHandler = handler;
        return ch;
      };
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: () => { state.removed++; },
    auth: { refreshSession: () => { state.refreshCalls++; return Promise.resolve({ data: {}, error: null }); } },
  };
  return { supabase, state };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: SB.supabase }));
vi.mock('../data/demoData', () => ({
  DATA_KEYS: [
    'financeiro_dividas', 'financeiro_receitas', 'financeiro_categorias_receita',
    'financeiro_categorias_divida', 'financeiro_saldo_inicial', 'financeiro_efetivacoes',
    'planeje_orcamentos', 'planeje_metas', 'planeje_cartoes', 'planeje_faturas',
    'planeje_tarefas', 'planeje_grupos', 'planeje_etiquetas', 'planeje_categorias_orcamento',
  ],
}));

// Import estático do código REAL (após os mocks/globais hoisted).
import * as cloud from '../services/cloudSync';

function resetState() {
  SB.state.upserts = [];
  SB.state.selectResult = { data: null, error: null };
  SB.state.upsertResult = { error: null };
  SB.state.systemHandler = null;
  SB.state.pgHandler = null;
  SB.state.removed = 0;
  SB.state.refreshCalls = 0;
  globalThis.localStorage.clear();
  window._listeners && Object.keys(window._listeners).forEach(k => window._listeners[k].clear());
  document._listeners && Object.keys(document._listeners).forEach(k => document._listeners[k].clear());
  document.visibilityState = 'visible';
}

beforeEach(resetState);
afterEach(async () => { await cloud.stopCloudSync(false); });

// ===========================================================================
describe('A. QuotaExceededError', () => {
  it('1. escrita que estoura a cota loga erro e despacha planeje-storage-full', async () => {
    // Módulo isolado com localStorage cujo setItem lança QuotaExceededError.
    vi.resetModules();
    const prevLS = globalThis.localStorage;
    globalThis.localStorage = {
      setItem: () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; },
      getItem: () => null,
      removeItem: () => {},
    };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = [];
    const dispSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation((e) => { events.push(e.type); return true; });

    const mod = await import('../services/cloudSync');
    mod.safeSet('financeiro_dividas', 'qualquer-valor');

    expect(errSpy).toHaveBeenCalled();
    expect(events).toContain('planeje-storage-full');

    dispSpy.mockRestore();
    errSpy.mockRestore();
    globalThis.localStorage = prevLS;
    vi.resetModules();
  });
});

// ===========================================================================
describe('B. JSON corrompido', () => {
  it('2. mergeKey com JSON inválido na nuvem devolve fallback local válido', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const local = JSON.stringify([{ id: 'a1', nome: 'Aluguel' }]);
    const out = cloud.mergeKey('{json invalido', local, new Set());
    // Não lança e mantém o dado local íntegro.
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out)[0].id).toBe('a1');
    errSpy.mockRestore();
  });

  it('3. cloudVal corrompido em uma chave não impede as demais de sincronizar', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Sem dado local para nenhuma; dividas vem corrompida, receitas íntegra.
    cloud.applyCloudData({
      financeiro_dividas: '{corrompido',
      financeiro_receitas: JSON.stringify([{ id: 'r1', nome: 'Salário' }]),
    });
    // A chave corrompida NÃO é gravada (não persiste lixo)...
    expect(globalThis.localStorage.getItem('financeiro_dividas')).toBeNull();
    // ...mas a chave íntegra é processada normalmente.
    const receitas = JSON.parse(globalThis.localStorage.getItem('financeiro_receitas'));
    expect(receitas[0].id).toBe('r1');
    errSpy.mockRestore();
  });
});

// ===========================================================================
describe('C. withRetry', () => {
  it('4. falha 2x e sucede na 3ª → retorna sucesso com 2 retries logados', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const fn = vi.fn(async () => { calls++; if (calls < 3) throw new Error('falha ' + calls); return 'ok'; });
    const res = await cloud.withRetry(fn, 3, 1); // baseDelay 1ms para rodar rápido
    expect(res).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    const retryWarns = warnSpy.mock.calls.filter(c => String(c[0]).includes('tentativa'));
    expect(retryWarns.length).toBe(2);
    warnSpy.mockRestore();
  });

  it('5. sempre falha → erro propagado após maxAttempts', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi.fn(async () => { throw new Error('sempre falha'); });
    await expect(cloud.withRetry(fn, 3, 1)).rejects.toThrow('sempre falha');
    expect(fn).toHaveBeenCalledTimes(3);
    warnSpy.mockRestore();
  });
});

// ===========================================================================
describe('D. withTimeout', () => {
  it('6. promise mais lenta que o timeout → rejeita com erro de timeout', async () => {
    const slow = new Promise(r => setTimeout(() => r('tarde'), 200));
    await expect(cloud.withTimeout(slow, 100)).rejects.toThrow(/timeout/);
  });

  it('7. promise mais rápida que o timeout → resolve normalmente', async () => {
    const fast = new Promise(r => setTimeout(() => r('rápido'), 50));
    await expect(cloud.withTimeout(fast, 100)).resolves.toBe('rápido');
  });
});

// ===========================================================================
describe('G. Realtime disconnect', () => {
  it('8. status CHANNEL_ERROR remove o canal e agenda reconexão', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    cloud.startCloudSync('user-8');
    expect(SB.state.systemHandler).toBeTypeOf('function');

    const removedBefore = SB.state.removed;
    setTimeoutSpy.mockClear();
    SB.state.systemHandler('CHANNEL_ERROR');

    expect(SB.state.removed).toBe(removedBefore + 1);
    const reconnectScheduled = setTimeoutSpy.mock.calls.some(c => c[1] === 3000);
    expect(reconnectScheduled).toBe(true);

    setTimeoutSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ===========================================================================
describe('I. Push ao ocultar (Page Visibility)', () => {
  it('9. visibilitychange=hidden dispara push (upsert) para a nuvem', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Semeia um dado ANTES do start (setItem ainda nativo).
    globalThis.localStorage.setItem('financeiro_receitas', JSON.stringify([{ id: 'r1' }]));

    cloud.startCloudSync('user-9');
    document.visibilityState = 'hidden';
    document.dispatchEvent(new CustomEvent('visibilitychange'));

    await vi.waitFor(() => expect(SB.state.upserts.length).toBeGreaterThan(0));
    expect(SB.state.upserts[SB.state.upserts.length - 1].user_id).toBe('user-9');
    logSpy.mockRestore();
  });
});

// ===========================================================================
describe('L. localStorage indisponível', () => {
  it('10. acesso a localStorage que lança no import → fallback gracioso, safeSet não quebra', async () => {
    vi.resetModules();
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('SecurityError: localStorage bloqueado'); },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mod = await import('../services/cloudSync');
    // Não deve lançar mesmo com storage indisponível.
    expect(() => mod.safeSet('financeiro_dividas', 'x')).not.toThrow();
    const logged = errSpy.mock.calls.some(c => String(c[0]).includes('localStorage indisponível'));
    expect(logged).toBe(true);

    errSpy.mockRestore();
    if (prevDesc) Object.defineProperty(globalThis, 'localStorage', prevDesc);
    vi.resetModules();
  });
});

// ===========================================================================
describe('J/K. Tratamento de 401 e 403', () => {
  it('11. erro 401 despacha planeje-auth-expired e sinaliza parada', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = [];
    const dispSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation((e) => { events.push(e.type); return true; });

    const action = cloud.handleSyncError({ status: 401 });

    expect(action).toBe('stop');
    expect(events).toContain('planeje-auth-expired');

    dispSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('12. erro 403 loga RLS, não retenta e despacha planeje-sync-error', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = [];
    const dispSpy = vi.spyOn(window, 'dispatchEvent').mockImplementation((e) => { events.push(e.type); return true; });

    const action = cloud.handleSyncError({ status: 403 });

    expect(action).toBe('stop'); // 403 não deve entrar em loop de retry
    expect(events).toContain('planeje-sync-error');
    expect(events).not.toContain('planeje-auth-expired');
    const loggedRls = errSpy.mock.calls.some(c => String(c[0]).includes('403'));
    expect(loggedRls).toBe(true);

    dispSpy.mockRestore();
    errSpy.mockRestore();
  });
});

// ===========================================================================
describe('N. Conflito com mesmo timestamp', () => {
  it('13. mergeKey com updatedAt idêntico → nuvem vence (autoritativa)', () => {
    const ts = '2026-05-01T00:00:00.000Z';
    const cloudVal = JSON.stringify([{ id: 'x', nome: 'nuvem', updatedAt: ts }]);
    const localVal = JSON.stringify([{ id: 'x', nome: 'local', updatedAt: ts }]);
    const out = JSON.parse(cloud.mergeKey(cloudVal, localVal));
    expect(out).toHaveLength(1);
    expect(out[0].nome).toBe('nuvem');
  });
});
