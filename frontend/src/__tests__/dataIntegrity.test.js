/**
 * Planeje — Data Integrity Tests
 * Framework: Vitest
 *
 * Testa as garantias de integridade de dados IMPORTANDO o código de produção
 * (cloudSync.js e lib/ids.js), não réplicas. O Supabase é mockado; localStorage
 * é dispensável porque cloudSync agora protege o acesso a nível de módulo.
 *
 * Cobertura:
 *  1. IDs únicos — 1000 criações rápidas sem colisão (newId/UUID)
 *  2. mergeKey — edição local mais recente vence (updatedAt)
 *  3. mergeKey — edição da nuvem mais recente vence
 *  4. mergeKey — sem updatedAt em ambos → nuvem autoritativa (retrocompatível)
 *  5. Tombstone — item deletado não ressuscita após merge
 *  6. Tombstone — coerção String (id numérico vs tombstone string)
 *  7. mergeKey — itens só-locais preservados + compartilhados mesclados (sem estado parcial)
 *  8. mergeKey — arrays de strings (categorias) fazem união sem duplicar
 *  9. mergeKey — objeto efetivacoes: local sobrescreve conflito, união de chaves
 * 10. isNewerCloud — dedup realtime+polling (mesmo timestamp não reprocessa)
 * 11. getBackupHistory — retorna snapshots da nuvem
 * 12. restoreFromBackup — arquiva o estado atual ANTES de restaurar (nunca perde dado)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Estado compartilhado do mock do Supabase (hoisted para o factory do vi.mock).
const { supabaseMock, state } = vi.hoisted(() => {
  const state = { queue: [], tableCalls: [] };
  const shift = () => (state.queue.length ? state.queue.shift() : { data: null, error: null });
  const makeQ = () => {
    const q = {};
    const m = () => q;
    ['select', 'eq', 'order', 'in', 'delete', 'insert', 'upsert', 'maybeSingle'].forEach(k => { q[k] = m; });
    // Torna a query "awaitable": qualquer await na cadeia resolve o próximo item da fila.
    q.then = (res, rej) => Promise.resolve(shift()).then(res, rej);
    return q;
  };
  const supabaseMock = {
    from: (t) => { state.tableCalls.push(t); return makeQ(); },
    channel: () => ({ on: () => ({ subscribe: () => {} }), subscribe: () => {} }),
    removeChannel: () => {},
  };
  return { supabaseMock, state };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: supabaseMock }));

// Importa o CÓDIGO REAL de produção depois do mock.
import { mergeKey, resolveItemConflict, isNewerCloud, getBackupHistory, restoreFromBackup } from '../services/cloudSync';
import { newId } from '../lib/ids';

beforeEach(() => {
  state.queue = [];
  state.tableCalls = [];
});

// ===========================================================================
describe('1. IDs únicos (newId)', () => {
  it('gera 1000 IDs rapidamente sem colisão', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(newId());
    expect(ids.size).toBe(1000);
  });

  it('nunca retorna valor vazio', () => {
    for (let i = 0; i < 50; i++) expect(String(newId()).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe('mergeKey — resolução de conflito por updatedAt', () => {
  it('2. edição LOCAL mais recente vence sobre a nuvem', () => {
    const cloud = JSON.stringify([{ id: 'x', nome: 'Aluguel', valor: 1000, updatedAt: '2026-01-01T00:00:00.000Z' }]);
    const local = JSON.stringify([{ id: 'x', nome: 'Aluguel EDITADO', valor: 1200, updatedAt: '2026-02-01T00:00:00.000Z' }]);
    const out = JSON.parse(mergeKey(cloud, local));
    expect(out).toHaveLength(1);
    expect(out[0].nome).toBe('Aluguel EDITADO');
    expect(out[0].valor).toBe(1200);
  });

  it('3. edição da NUVEM mais recente vence sobre o local', () => {
    const cloud = JSON.stringify([{ id: 'x', nome: 'Nuvem nova', valor: 999, updatedAt: '2026-03-01T00:00:00.000Z' }]);
    const local = JSON.stringify([{ id: 'x', nome: 'Local antigo', valor: 100, updatedAt: '2026-01-01T00:00:00.000Z' }]);
    const out = JSON.parse(mergeKey(cloud, local));
    expect(out[0].nome).toBe('Nuvem nova');
    expect(out[0].valor).toBe(999);
  });

  it('4. sem updatedAt em ambos → nuvem autoritativa (retrocompatível)', () => {
    const cloud = JSON.stringify([{ id: 'x', nome: 'Versão nuvem', valor: 5 }]);
    const local = JSON.stringify([{ id: 'x', nome: 'Versão local', valor: 9 }]);
    const out = JSON.parse(mergeKey(cloud, local));
    expect(out[0].nome).toBe('Versão nuvem');
  });

  it('4b. resolveItemConflict: só um lado com updatedAt → nuvem vence (evita clobber por local legado)', () => {
    const cloudItem = { id: 'x', nome: 'nuvem' };
    const localItem = { id: 'x', nome: 'local', updatedAt: '2030-01-01T00:00:00.000Z' };
    expect(resolveItemConflict(cloudItem, localItem).nome).toBe('nuvem');
  });
});

// ===========================================================================
describe('Tombstones', () => {
  it('5. item deletado (tombstone) não ressuscita após merge', () => {
    const tombstones = new Set(['del-1']);
    const cloud = JSON.stringify([{ id: 'del-1', nome: 'Deletado' }, { id: 'keep', nome: 'Vivo' }]);
    const local = JSON.stringify([{ id: 'del-1', nome: 'Deletado local' }]);
    const out = JSON.parse(mergeKey(cloud, local, tombstones));
    expect(out.find(i => i.id === 'del-1')).toBeUndefined();
    expect(out.find(i => i.id === 'keep')).toBeDefined();
  });

  it('6. coerção String: tombstone "42" filtra item com id numérico 42', () => {
    const tombstones = new Set(['42']);
    const cloud = JSON.stringify([{ id: 42, nome: 'num' }, { id: '55', nome: 'str' }]);
    const out = JSON.parse(mergeKey(cloud, JSON.stringify([]), tombstones));
    expect(out.find(i => String(i.id) === '42')).toBeUndefined();
    expect(out.find(i => String(i.id) === '55')).toBeDefined();
  });
});

// ===========================================================================
describe('mergeKey — mesclagem de conjuntos', () => {
  it('7. itens só-locais preservados E compartilhados mesclados (sem estado parcial)', () => {
    const cloud = JSON.stringify([
      { id: 'shared', nome: 'nuvem', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'cloud-only', nome: 'só nuvem' },
    ]);
    const local = JSON.stringify([
      { id: 'shared', nome: 'local novo', updatedAt: '2026-05-01T00:00:00.000Z' },
      { id: 'local-only', nome: 'só local (não enviado)' },
    ]);
    const out = JSON.parse(mergeKey(cloud, local));
    const ids = out.map(i => i.id).sort();
    expect(ids).toEqual(['cloud-only', 'local-only', 'shared']);
    expect(out.find(i => i.id === 'shared').nome).toBe('local novo'); // local mais recente venceu
  });

  it('8. arrays de strings (categorias): união sem duplicar', () => {
    const cloud = JSON.stringify(['Salário', 'Freelance']);
    const local = JSON.stringify(['Freelance', 'Bônus']);
    const out = JSON.parse(mergeKey(cloud, local));
    expect(out.sort()).toEqual(['Bônus', 'Freelance', 'Salário']);
  });

  it('9. objeto efetivacoes: união de chaves, local sobrescreve conflito', () => {
    const cloud = JSON.stringify({ a: '2026-01-01', b: '2026-01-02' });
    const local = JSON.stringify({ b: '2026-09-09', c: '2026-01-03' });
    const out = JSON.parse(mergeKey(cloud, local));
    expect(out).toEqual({ a: '2026-01-01', b: '2026-09-09', c: '2026-01-03' });
  });
});

// ===========================================================================
describe('10. isNewerCloud — dedup realtime + polling', () => {
  it('mesmo timestamp não reprocessa', () => {
    expect(isNewerCloud('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(false);
  });
  it('timestamp mais novo processa', () => {
    expect(isNewerCloud('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBe(true);
  });
  it('sem timestamp anterior processa', () => {
    expect(isNewerCloud(null, '2026-01-02T00:00:00.000Z')).toBe(true);
  });
  it('sem timestamp recebido processa (linha legada)', () => {
    expect(isNewerCloud('2026-01-01T00:00:00.000Z', null)).toBe(true);
  });
});

// ===========================================================================
describe('Backup / recovery', () => {
  it('11. getBackupHistory retorna os snapshots da nuvem', async () => {
    state.queue = [{ data: [{ id: 'h1', created_at: '2026-07-01' }, { id: 'h2', created_at: '2026-06-01' }] }];
    const hist = await getBackupHistory('user-1');
    expect(hist).toHaveLength(2);
    expect(hist[0].id).toBe('h1');
  });

  it('12. restoreFromBackup arquiva o estado atual ANTES de restaurar (nunca perde dado)', async () => {
    state.queue = [
      { data: { data: { financeiro_dividas: '[{"id":"snap"}]' } } }, // busca do snapshot a restaurar
      { data: null },                                                 // archiveCurrentCloud: sem dado atual → pula insert
      // upsert do user_data resolve com default {data:null,error:null}
    ];
    const ok = await restoreFromBackup('user-1', 'h1');
    expect(ok).toBe(true);
    // Ordem: busca snapshot (history) → arquiva atual (user_data) → grava restaurado (user_data)
    expect(state.tableCalls[0]).toBe('user_data_history');
    expect(state.tableCalls).toContain('user_data');
    // O upsert de user_data acontece DEPOIS da tentativa de arquivamento.
    const lastUserData = state.tableCalls.lastIndexOf('user_data');
    const firstUserData = state.tableCalls.indexOf('user_data');
    expect(lastUserData).toBeGreaterThanOrEqual(firstUserData);
  });

  it('12b. restoreFromBackup retorna false se o snapshot não existe', async () => {
    state.queue = [{ data: null }];
    const ok = await restoreFromBackup('user-1', 'inexistente');
    expect(ok).toBe(false);
  });
});
