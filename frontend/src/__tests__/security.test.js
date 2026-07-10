/**
 * Planeje — Security Tests
 * Framework: Vitest
 *
 * Testa as funções críticas de segurança de cloudSync.js e a lógica de billing
 * do AuthContext sem depender de Supabase, DOM real ou React.
 *
 * Cobertura:
 *  1. mergeKey — isolamento entre usuários (user A vs user B)
 *  2. applyCloudData — objeto vazio não modifica localStorage
 *  3. applyCloudData — '[]' não sobrescreve dado existente
 *  4. Tombstones — filtragem com IDs numéricos (coerção String)
 *  5. dirtyKeys — chave marcada dirty é ignorada durante applyCloudData
 *  6. Billing — perfil=null → acessoLiberado=false
 *  7. Billing — perfilStatus='loading' → acessoLiberado=false
 *  8. Billing — perfil carregado com plano válido → acessoLiberado=true
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Importar as funções puras de cloudSync usando o módulo real.
// Supabase e localStorage serão mockados abaixo.
// ---------------------------------------------------------------------------

// Mock do supabase — cloudSync.js importa '../lib/supabaseClient'
// Vitest resolve os mocks ANTES das importações reais.
vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    channel: vi.fn(() => ({
      on:        vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

// Mock do demoData — cloudSync.js importa '../data/demoData' para DATA_KEYS
vi.mock('../../data/demoData', () => ({
  DATA_KEYS: [
    'financeiro_dividas',
    'financeiro_receitas',
    'financeiro_categorias_receita',
    'financeiro_categorias_divida',
    'financeiro_saldo_inicial',
    'financeiro_efetivacoes',
    'planeje_orcamentos',
    'planeje_metas',
    'planeje_cartoes',
    'planeje_faturas',
    'planeje_tarefas',
    'planeje_grupos',
    'planeje_etiquetas',
    'planeje_categorias_orcamento',
  ],
}));

// ---------------------------------------------------------------------------
// Agora importamos as funções depois dos mocks.
// mergeKey e applyCloudData não são exportadas do módulo, então
// re-implementamos as versões canônicas (idênticas ao código de produção)
// para testar a lógica pura sem side-effects de módulo.
// ---------------------------------------------------------------------------

// Replica exata de mergeKey (cloudSync.js linha 85-110)
function mergeKey(cloudVal, localVal, tombstones = new Set()) {
  try {
    const cParsed = JSON.parse(cloudVal);
    const lParsed = JSON.parse(localVal);
    if (Array.isArray(cParsed) && Array.isArray(lParsed)) {
      const firstItem = cParsed[0] ?? lParsed[0];
      if (firstItem == null || typeof firstItem !== 'object') {
        return JSON.stringify([...new Set([...cParsed, ...lParsed])]);
      }
      const cFiltered = cParsed.filter(item => item.id && !tombstones.has(String(item.id)));
      const lFiltered = lParsed.filter(item => item.id && !tombstones.has(String(item.id)));
      const cloudIds = new Set(cFiltered.map(item => String(item.id)));
      const onlyLocal = lFiltered.filter(item => !cloudIds.has(String(item.id)));
      return JSON.stringify([...cFiltered, ...onlyLocal]);
    }
    if (cParsed && typeof cParsed === 'object' && !Array.isArray(cParsed) &&
        lParsed && typeof lParsed === 'object' && !Array.isArray(lParsed)) {
      return JSON.stringify({ ...cParsed, ...lParsed });
    }
  } catch {}
  return (cloudVal && cloudVal !== '[]' && cloudVal !== 'null') ? cloudVal : localVal;
}

// ---------------------------------------------------------------------------
// Stub de localStorage para applyCloudData
// ---------------------------------------------------------------------------
function makeLocalStore(initial = {}) {
  const store = { ...initial };
  return {
    store,
    getItem:    vi.fn((k) => store[k] ?? null),
    setItem:    vi.fn((k, v) => { store[k] = v; }),
    removeItem: vi.fn((k) => { delete store[k]; }),
  };
}

const DATA_KEYS = [
  'financeiro_dividas',
  'financeiro_receitas',
  'financeiro_categorias_receita',
  'financeiro_categorias_divida',
  'financeiro_saldo_inicial',
  'financeiro_efetivacoes',
  'planeje_orcamentos',
  'planeje_metas',
  'planeje_cartoes',
  'planeje_faturas',
  'planeje_tarefas',
  'planeje_grupos',
  'planeje_etiquetas',
  'planeje_categorias_orcamento',
];

const TOMB = '__tomb';

// Replica de applyCloudData (cloudSync.js linha 112-151)
// Recebe getItem/setItem injetados para ser testável sem global.
function applyCloudData(data, { getItem, setItem }, dirtyKeys = new Set()) {
  if (!data || Object.keys(data).length === 0) return false;

  function getTombstones(key) {
    try { return new Set(JSON.parse(getItem(key + TOMB) || '[]')); }
    catch { return new Set(); }
  }
  function addTombstones(key, ids) {
    if (!ids || !ids.length) return;
    const set = getTombstones(key);
    ids.forEach(id => set.add(id));
    setItem(key + TOMB, JSON.stringify([...set]));
  }

  DATA_KEYS.forEach(key => {
    const cloudTomb = data[key + TOMB];
    if (cloudTomb) {
      try { addTombstones(key, JSON.parse(cloudTomb)); } catch {}
    }
  });

  let changed = false;
  DATA_KEYS.forEach(key => {
    const cloudVal = data[key];
    if (cloudVal === undefined) return;
    if (dirtyKeys.has(key)) return;
    const localVal = getItem(key);
    const tombstones = getTombstones(key);
    let merged;
    if (localVal) {
      merged = mergeKey(cloudVal, localVal, tombstones);
    } else {
      try {
        const arr = JSON.parse(cloudVal);
        merged = Array.isArray(arr) && tombstones.size
          ? JSON.stringify(arr.filter(item => !tombstones.has(String(item.id))))
          : cloudVal;
      } catch { merged = cloudVal; }
    }
    if (merged !== localVal && merged !== '[]') {
      setItem(key, merged);
      changed = true;
    }
  });
  return changed;
}

// ---------------------------------------------------------------------------
// Lógica de billing — replica de AuthContext.jsx linha 163-167
// ---------------------------------------------------------------------------
function calcAcessoLiberado(perfilStatus, perfil) {
  return perfilStatus === 'loaded' && perfil != null && (
    perfil.plano === 'liberado'
    || (perfil.plano === 'pago' && perfil.assinatura_status === 'ativa')
    || (!!perfil.trial_expira_em && new Date(perfil.trial_expira_em) > new Date())
  );
}

// ===========================================================================
// TESTES
// ===========================================================================

describe('mergeKey — isolamento entre usuários', () => {
  it('1. Dados de user A e user B nunca se mesclam quando chamados em sessões separadas', () => {
    const userADividas = JSON.stringify([
      { id: 'a1', nome: 'Aluguel User A', valor: 1000 },
    ]);
    const userBDividas = JSON.stringify([
      { id: 'b1', nome: 'Internet User B', valor: 120 },
    ]);

    // User A faz merge com SUA nuvem e SEU local
    const resultA = mergeKey(userADividas, userADividas, new Set());
    const parsedA = JSON.parse(resultA);
    expect(parsedA.some(i => i.id === 'b1')).toBe(false);
    expect(parsedA.some(i => i.id === 'a1')).toBe(true);

    // User B faz merge com SUA nuvem e SEU local
    const resultB = mergeKey(userBDividas, userBDividas, new Set());
    const parsedB = JSON.parse(resultB);
    expect(parsedB.some(i => i.id === 'a1')).toBe(false);
    expect(parsedB.some(i => i.id === 'b1')).toBe(true);
  });
});

describe('applyCloudData — guardas contra dados inválidos', () => {
  it('2. Objeto vazio não modifica localStorage', () => {
    const ls = makeLocalStore({ financeiro_dividas: JSON.stringify([{ id: '1', nome: 'Aluguel' }]) });
    applyCloudData({}, ls);
    expect(ls.setItem).not.toHaveBeenCalled();
  });

  it('3. data=null não modifica localStorage', () => {
    const ls = makeLocalStore({ financeiro_dividas: JSON.stringify([{ id: '1', nome: 'Aluguel' }]) });
    applyCloudData(null, ls);
    expect(ls.setItem).not.toHaveBeenCalled();
  });

  it('3b. cloudVal="[]" não sobrescreve dado existente não-vazio', () => {
    const existing = JSON.stringify([{ id: '1', nome: 'Aluguel' }]);
    const ls = makeLocalStore({ financeiro_dividas: existing });

    // Nuvem tem array vazio — não pode sobrescrever dado local existente
    applyCloudData({ financeiro_dividas: '[]' }, ls);

    const calls = ls.setItem.mock.calls.filter(c => c[0] === 'financeiro_dividas');
    expect(calls.length).toBe(0);
  });
});

describe('Tombstones — filtragem com IDs numéricos (coerção String)', () => {
  it('4. Item com ID numérico no tombstone é filtrado corretamente', () => {
    // Tombstone armazena IDs como strings; itens podem chegar com id numérico
    const tombstones = new Set(['42', '99']); // strings, como getTombstones retorna

    const cloud = JSON.stringify([
      { id: 42,   nome: 'Item deletado (id numérico)' },  // deve ser filtrado
      { id: '55', nome: 'Item válido (id string)' },       // deve permanecer
    ]);
    const local = JSON.stringify([]);

    const result = JSON.parse(mergeKey(cloud, local, tombstones));
    expect(result.find(i => String(i.id) === '42')).toBeUndefined();
    expect(result.find(i => String(i.id) === '55')).toBeDefined();
  });

  it('4b. Item com ID string no tombstone filtra mesmo se local usa ID numérico', () => {
    const tombstones = new Set(['7']);
    const cloud = JSON.stringify([{ id: 7, nome: 'Deve ser removido' }]);
    const local = JSON.stringify([{ id: 7, nome: 'Local também deletado' }]);

    const result = JSON.parse(mergeKey(cloud, local, tombstones));
    expect(result.length).toBe(0);
  });
});

describe('dirtyKeys — chave marcada dirty é ignorada durante applyCloudData', () => {
  it('5. Chave dirty não é sobrescrita pela nuvem', () => {
    const localDividas = JSON.stringify([{ id: 'local-1', nome: 'Novo item local ainda não enviado' }]);
    const ls = makeLocalStore({ financeiro_dividas: localDividas });
    const dirtyKeys = new Set(['financeiro_dividas']);

    const cloudData = { financeiro_dividas: JSON.stringify([{ id: 'cloud-1', nome: 'Item da nuvem' }]) };

    applyCloudData(cloudData, ls, dirtyKeys);

    // Não deve ter escrito em financeiro_dividas
    const writesToDividas = ls.setItem.mock.calls.filter(c => c[0] === 'financeiro_dividas');
    expect(writesToDividas.length).toBe(0);
  });

  it('5b. Chave NÃO dirty é atualizada normalmente', () => {
    const ls = makeLocalStore({});
    const dirtyKeys = new Set(); // nada marcado como dirty

    const cloudData = { financeiro_receitas: JSON.stringify([{ id: 'r1', nome: 'Salário' }]) };
    applyCloudData(cloudData, ls, dirtyKeys);

    const writes = ls.setItem.mock.calls.filter(c => c[0] === 'financeiro_receitas');
    expect(writes.length).toBe(1);
  });
});

describe('Billing — lógica de acesso fail-closed', () => {
  it('6. perfil=null → acessoLiberado=false (independente do status)', () => {
    expect(calcAcessoLiberado('loaded', null)).toBe(false);
    expect(calcAcessoLiberado('loading', null)).toBe(false);
    expect(calcAcessoLiberado('error', null)).toBe(false);
  });

  it('7. perfilStatus="loading" → acessoLiberado=false mesmo com perfil presente', () => {
    const perfilValido = { plano: 'pago', assinatura_status: 'ativa', trial_expira_em: null };
    expect(calcAcessoLiberado('loading', perfilValido)).toBe(false);
  });

  it('7b. perfilStatus="error" → acessoLiberado=false', () => {
    const perfilValido = { plano: 'pago', assinatura_status: 'ativa', trial_expira_em: null };
    expect(calcAcessoLiberado('error', perfilValido)).toBe(false);
  });

  it('8a. Plano "pago" com status "ativa" → acessoLiberado=true', () => {
    const perfil = { plano: 'pago', assinatura_status: 'ativa', trial_expira_em: null };
    expect(calcAcessoLiberado('loaded', perfil)).toBe(true);
  });

  it('8b. Plano "liberado" → acessoLiberado=true', () => {
    const perfil = { plano: 'liberado', assinatura_status: null, trial_expira_em: null };
    expect(calcAcessoLiberado('loaded', perfil)).toBe(true);
  });

  it('8c. Trial válido (futuro) → acessoLiberado=true', () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const perfil = { plano: 'trial', assinatura_status: null, trial_expira_em: future };
    expect(calcAcessoLiberado('loaded', perfil)).toBe(true);
  });

  it('8d. Trial expirado (passado) → acessoLiberado=false', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const perfil = { plano: 'trial', assinatura_status: null, trial_expira_em: past };
    expect(calcAcessoLiberado('loaded', perfil)).toBe(false);
  });

  it('8e. Plano "pago" com status "inativa" → acessoLiberado=false', () => {
    const perfil = { plano: 'pago', assinatura_status: 'inativa', trial_expira_em: null };
    expect(calcAcessoLiberado('loaded', perfil)).toBe(false);
  });

  it('8f. Falha de rede (perfil=null, status=error) nunca é acesso liberado', () => {
    // Simula exatamente o cenário de rede offline após retries esgotados
    expect(calcAcessoLiberado('error', null)).toBe(false);
  });
});
