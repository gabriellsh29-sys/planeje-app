/**
 * Planeje — Polling do cloudSync e consumo de egress (Supabase)
 * Framework: Vitest
 *
 * Contexto: o polling baixava o JSON inteiro (`data`) a cada 5 s por aba aberta, mesmo
 * sem mudança, e estourou a cota de egress do Supabase. Estes testes provam que:
 *  1. Sem dado novo, o ciclo pede só `updated_at` e NUNCA baixa `data`.
 *  2. Com dado mais novo, o ciclo baixa `data` e aplica no localStorage.
 *  3. O intervalo é >= 60 s e não consulta o banco com a aba oculta.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
  function makeMemLS() {
    const store = {};
    return {
      _store: store,
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    };
  }
  globalThis.window = makeEmitter();
  const doc = makeEmitter();
  doc.visibilityState = 'visible';
  globalThis.document = doc;
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
  };
  globalThis.BroadcastChannel = class BroadcastChannel {
    constructor() {} postMessage() {} close() {} set onmessage(_) {}
  };
  globalThis.localStorage = makeMemLS();
  return {};
});

const SB = vi.hoisted(() => {
  const state = {
    // colunas pedidas em cada select de user_data, na ordem das chamadas
    userDataSelects: [],
    probeResult: { data: null, error: null },
    fullResult: { data: null, error: null },
  };
  const thenable = (getResult) => ({ then: (res, rej) => Promise.resolve(getResult()).then(res, rej) });
  const makeQuery = (table) => {
    const q = { _cols: null };
    q.select = (cols) => { q._cols = cols; return q; };
    ['eq', 'order', 'in', 'delete', 'insert'].forEach(k => { q[k] = () => q; });
    q.upsert = () => thenable(() => ({ error: null }));
    const result = () => {
      if (table !== 'user_data') return { data: null, error: null };
      state.userDataSelects.push(q._cols);
      return q._cols === 'updated_at' ? state.probeResult : state.fullResult;
    };
    q.maybeSingle = () => thenable(result);
    q.then = (res, rej) => Promise.resolve(result()).then(res, rej);
    return q;
  };
  const supabase = {
    from: (table) => makeQuery(table),
    channel: () => {
      const ch = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: () => {},
    auth: { refreshSession: () => Promise.resolve({ data: {}, error: null }) },
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

import * as cloud from '../services/cloudSync';

const T1 = '2026-11-06T10:00:00.000Z';
const T2 = '2026-11-06T10:05:00.000Z';
const USER = 'user-egress';

function cloudRow(ts, receitas) {
  return { data: { data: { financeiro_receitas: JSON.stringify(receitas) }, updated_at: ts }, error: null };
}

// Deixa a nuvem em T1 já aplicada (lastAppliedCloudTs = T1) e zera o registro de consultas.
async function primeWithCloudAt(ts) {
  SB.state.fullResult = cloudRow(ts, [{ id: 'r1' }]);
  await cloud.pullFromCloud(USER);
  SB.state.userDataSelects = [];
}

function triggerVisible() {
  document.visibilityState = 'visible';
  document.dispatchEvent(new CustomEvent('visibilitychange'));
}

beforeEach(() => {
  SB.state.userDataSelects = [];
  SB.state.probeResult = { data: null, error: null };
  SB.state.fullResult = { data: null, error: null };
  globalThis.localStorage.clear();
  window._listeners && Object.keys(window._listeners).forEach(k => window._listeners[k].clear());
  document._listeners && Object.keys(document._listeners).forEach(k => document._listeners[k].clear());
  document.visibilityState = 'visible';
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(async () => {
  vi.useRealTimers();
  await cloud.stopCloudSync(false);
  vi.restoreAllMocks();
});

describe('Polling do cloudSync — egress', () => {
  it('1. sem dado novo, o ciclo pede só updated_at e nunca baixa o JSON (data)', async () => {
    cloud.startCloudSync(USER);          // como em produção: start primeiro...
    await primeWithCloudAt(T1);          // ...e o pull inicial repõe o carimbo aplicado

    SB.state.probeResult = { data: { updated_at: T1 }, error: null }; // mesmo carimbo já aplicado
    triggerVisible();

    await vi.waitFor(() => expect(SB.state.userDataSelects).toContain('updated_at'));
    await new Promise(r => setTimeout(r, 30));
    expect(SB.state.userDataSelects.filter(c => c !== 'updated_at')).toEqual([]);
  });

  it('2. com dado mais novo na nuvem, baixa o JSON e aplica no localStorage', async () => {
    cloud.startCloudSync(USER);          // como em produção: start primeiro...
    await primeWithCloudAt(T1);          // ...e o pull inicial repõe o carimbo aplicado

    SB.state.probeResult = { data: { updated_at: T2 }, error: null };
    SB.state.fullResult = cloudRow(T2, [{ id: 'r1' }, { id: 'r2-de-outro-aparelho' }]);
    triggerVisible();

    await vi.waitFor(() => expect(SB.state.userDataSelects).toContain('data, updated_at'));
    await vi.waitFor(() => {
      const salvo = JSON.parse(globalThis.localStorage.getItem('financeiro_receitas') || '[]');
      expect(salvo.some(r => r.id === 'r2-de-outro-aparelho')).toBe(true);
    });
  });

  it('3. o intervalo é de pelo menos 60 s', () => {
    expect(cloud.POLL_INTERVAL_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('4. com a aba oculta o polling não consulta o banco; visível, consulta só o carimbo', async () => {
    vi.useFakeTimers();
    cloud.startCloudSync(USER);
    await primeWithCloudAt(T1);
    SB.state.probeResult = { data: { updated_at: T1 }, error: null };

    document.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(cloud.POLL_INTERVAL_MS * 3);
    expect(SB.state.userDataSelects).toEqual([]);

    document.visibilityState = 'visible';
    await vi.advanceTimersByTimeAsync(cloud.POLL_INTERVAL_MS);
    expect(SB.state.userDataSelects).toEqual(['updated_at']);
  });
});
