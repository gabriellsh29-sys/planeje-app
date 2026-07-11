import { supabase } from '../lib/supabaseClient';
import { DATA_KEYS } from '../data/demoData';

// Guarda contra ambientes sem localStorage (SSR / testes em Node / modo privado
// do Safari, onde o simples acesso a localStorage pode lançar). O bind é feito
// UMA vez na inicialização e capturado ANTES do patch em startCloudSync — por isso
// _native precisa referenciar o setItem nativo original (evita recursão infinita).
let _native, _native_get;
try {
  _native     = localStorage.setItem.bind(localStorage);
  _native_get = localStorage.getItem.bind(localStorage);
} catch (err) {
  _native     = () => {};
  _native_get = () => null;
  console.error('[cloudSync] localStorage indisponível — sync desabilitado:', err?.message ?? err);
}

// Tombstones: registram IDs de itens deletados para propagar deleções entre dispositivos
const TOMB = '__tomb';

let pushTimer         = null;
let currentUserId     = null;
let unpatch           = null;
let realtimeChannel   = null;
let visibilityCleanup = null;
let pollInterval      = null;
let bc                = null;   // BroadcastChannel: sincroniza abas do mesmo navegador
let onlineCleanup     = null;   // remove o listener de 'online'
let archiveInterval   = null;   // snapshot automático a cada 30 min
let lastAppliedCloudTs = null;  // dedup: último updated_at da nuvem já aplicado

// ---------------------------------------------------------------------------
// Utilitários de resiliência
// ---------------------------------------------------------------------------

// Retenta uma operação com backoff exponencial. Um erro marcado com __noRetry
// (ex.: 403 RLS) aborta imediatamente — repetir não resolveria.
export async function withRetry(fn, maxAttempts = 3, baseDelayMs = 1000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err && err.__noRetry) throw err;
      if (i === maxAttempts - 1) throw err;
      console.warn('[cloudSync] tentativa', i + 1, 'de', maxAttempts, 'falhou, repetindo...', err?.message ?? err);
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, i)));
    }
  }
}

// Corre uma promise contra um timeout — o SDK do Supabase pode travar sem devolver.
export function withTimeout(promise, ms = 10000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('timeout após ' + ms + 'ms')), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(t));
}

// Extrai o status HTTP/erro de um PostgrestError ou objeto de erro do Supabase.
export function classifySupabaseError(err) {
  if (!err) return null;
  const s = err.status ?? err.statusCode ?? err.httpStatus;
  if (Number.isFinite(s)) return s;
  const code = err.code;
  if (code === '42501') return 403;                    // insufficient_privilege (RLS)
  if (code === 'PGRST301' || code === '401') return 401; // JWT expirado
  const n = parseInt(code, 10);
  return Number.isFinite(n) ? n : null;
}

function dispatchAppEvent(name, detail) {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));
    }
  } catch (err) {
    console.error('[cloudSync] falha ao despachar evento', name, err?.message ?? err);
  }
}

// Classifica um erro de sync, registra e emite o evento apropriado.
// Retorna 'stop' quando o ciclo deve parar (sessão inválida) ou 'retry' caso contrário.
export function handleSyncError(err) {
  const status = classifySupabaseError(err);
  if (status === 401) {
    console.error('[cloudSync] Sessão expirada (401) — refresh falhou:', err?.message ?? err);
    dispatchAppEvent('planeje-auth-expired');
    return 'stop';
  }
  if (status === 403) {
    console.error('[cloudSync] Acesso negado (403) — RLS bloqueando operações de sync');
    dispatchAppEvent('planeje-sync-error');
    return 'stop';
  }
  console.error('[cloudSync] falha permanente de sync:', err?.message ?? err);
  dispatchAppEvent('planeje-sync-error');
  return 'retry';
}

// Interrompe os laços de sync (poll/push) sem tocar em dados — usado quando a
// sessão fica inválida, para não entrar em loop infinito de 401.
function haltSyncCycle() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (pushTimer)    { clearTimeout(pushTimer);    pushTimer = null; }
  console.warn('[cloudSync] ciclo de sync interrompido (sessão inválida)');
}

// Executa uma query do Supabase com timeout + retry + tratamento de status.
// O Supabase-js v2 não lança em erro de negócio: devolve { data, error }.
// Aqui convertemos o error em throw para o withRetry poder atuar.
async function runResilient(queryFactory) {
  let refreshed = false;
  return withRetry(async () => {
    const res = await withTimeout(queryFactory(), 10000);
    const error = res && res.error;
    if (error) {
      const status = classifySupabaseError(error);
      if (status === 401 && !refreshed) {
        refreshed = true;
        console.warn('[cloudSync] 401 — tentando refreshSession antes de repetir');
        try { await supabase.auth.refreshSession(); }
        catch (e) { console.error('[cloudSync] refreshSession falhou:', e?.message ?? e); }
        throw error; // permite retry após refresh
      }
      if (status === 403) {
        const e = new Error('403 RLS'); e.__noRetry = true; e.status = 403; throw e;
      }
      throw error;
    }
    return res;
  }, 3, 1000);
}

// ---------------------------------------------------------------------------
// Acesso seguro ao localStorage
// ---------------------------------------------------------------------------

// Escrita protegida: em QuotaExceededError (disco cheio) ou qualquer falha de
// escrita, registra e avisa a UI via evento — NUNCA deixa a exceção derrubar o app.
export function safeSet(key, value) {
  try {
    _native(key, value);
  } catch (err) {
    console.error('[cloudSync] localStorage cheio:', err);
    dispatchAppEvent('planeje-storage-full');
  }
}

function safeGet(key) {
  try {
    return _native_get(key);
  } catch (err) {
    console.error('[cloudSync] leitura de localStorage falhou para', key, err?.message ?? err);
    return null;
  }
}

// Notifica outras abas (BroadcastChannel) que o localStorage mudou.
function broadcast() { try { bc?.postMessage('sync'); } catch {} }

// Chaves modificadas localmente aguardando push — protege contra o pull sobrescrever edições no debounce de 500ms
const dirtyKeys = new Set();

function getTombstones(key) {
  try {
    return new Set(JSON.parse(safeGet(key + TOMB) || '[]'));
  } catch (err) {
    console.error('[cloudSync] tombstones corrompidos para', key, '— tratando como vazio:', err?.message ?? err);
    return new Set();
  }
}

function addTombstones(key, ids) {
  if (!ids || !ids.length) return;
  const set = getTombstones(key);
  ids.forEach(id => set.add(id));
  safeSet(key + TOMB, JSON.stringify([...set]));
}

function snapshotLocal() {
  const snap = {};
  DATA_KEYS.forEach(key => {
    const val = safeGet(key);
    if (val !== null) snap[key] = val;
    const tomb = safeGet(key + TOMB);
    if (tomb && tomb !== '[]') snap[key + TOMB] = tomb;
  });
  return snap;
}

async function archiveCurrentCloud(userId) {
  try {
    const { data: row } = await supabase.from('user_data').select('data').eq('user_id', userId).maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0) {
      await supabase.from('user_data_history').insert({ user_id: userId, data: row.data });
      // Checagem de integridade (não-criptográfica) apenas para observabilidade.
      console.log('[cloudSync] backup arquivado — checksum(len):', JSON.stringify(row.data).length);
      pruneHistory(userId).catch(() => {});
    }
  } catch (err) {
    console.error('[cloudSync] archiveCurrentCloud falhou:', err?.message ?? err);
  }
}

// Mantém no máximo `keep` snapshots por usuário (rotação de backups).
// Só remove excedentes DO PRÓPRIO usuário e nunca lança — se algo falhar, não apaga nada.
async function pruneHistory(userId, keep = 10) {
  try {
    const { data } = await supabase.from('user_data_history')
      .select('id').eq('user_id', userId).order('created_at', { ascending: false });
    if (!data || data.length <= keep) return;
    const toDelete = data.slice(keep).map(r => r.id);
    if (toDelete.length) {
      await supabase.from('user_data_history').delete().in('id', toDelete);
    }
  } catch (err) {
    console.error('[cloudSync] pruneHistory falhou:', err?.message ?? err);
  }
}

// Lista os snapshots disponíveis (mais recentes primeiro). Para uso futuro em UI de restauração.
export async function getBackupHistory(userId) {
  try {
    const { data } = await supabase.from('user_data_history')
      .select('id, created_at').eq('user_id', userId).order('created_at', { ascending: false });
    return data || [];
  } catch (err) {
    console.error('[cloudSync] getBackupHistory falhou:', err?.message ?? err);
    return [];
  }
}

// Restaura um snapshot. SEGURO: arquiva o estado atual ANTES de restaurar,
// então o dado corrente vira mais um item de histórico — nada é perdido.
export async function restoreFromBackup(userId, historyId) {
  try {
    const { data: snap } = await supabase.from('user_data_history')
      .select('data').eq('user_id', userId).eq('id', historyId).maybeSingle();
    if (!snap?.data || Object.keys(snap.data).length === 0) return false;
    await archiveCurrentCloud(userId);
    const ts = new Date().toISOString();
    await supabase.from('user_data')
      .upsert({ user_id: userId, data: snap.data, updated_at: ts }, { onConflict: 'user_id' });
    lastAppliedCloudTs = ts;
    applyCloudData(snap.data);
    return true;
  } catch (err) {
    console.error('[cloudSync] restoreFromBackup falhou:', err?.message ?? err);
    return false;
  }
}

async function pushToCloud(userId) {
  const snap = snapshotLocal();
  if (Object.keys(snap).length === 0) return;
  try { await archiveCurrentCloud(userId); } catch (err) {
    console.error('[cloudSync] pushToCloud/archive falhou:', err?.message ?? err);
  }
  try {
    await supabase.from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    console.log('[cloudSync] push concluído —', Object.keys(snap).length, 'chaves');
  } catch (err) {
    console.error('[cloudSync] pushToCloud/upsert falhou:', err?.message ?? err);
  }
}

async function lightPushToCloud(userId) {
  const snap = snapshotLocal();
  if (Object.keys(snap).length === 0) return;
  const ts = new Date().toISOString();
  try {
    await runResilient(() => supabase.from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: ts }, { onConflict: 'user_id' }));
    // Registra nosso próprio push para o eco do realtime/polling não re-aplicar à toa.
    lastAppliedCloudTs = ts;
    dirtyKeys.clear();
    console.log('[cloudSync] push concluído —', Object.keys(snap).length, 'chaves');
  } catch (err) {
    if (handleSyncError(err) === 'stop') haltSyncCycle();
  }
}

function schedulePush(userId) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => lightPushToCloud(userId), 500);
}

// Resolve conflito de um item presente NA NUVEM e NO LOCAL.
// Regra: se AMBOS têm updatedAt, o mais recente vence — protege a edição feita
// em outro dispositivo de ser sobrescrita por uma versão antiga.
// Se algum não tem updatedAt (item legado), a nuvem é autoritativa (retrocompatível).
export function resolveItemConflict(cloudItem, localItem) {
  const cu = cloudItem && cloudItem.updatedAt;
  const lu = localItem && localItem.updatedAt;
  if (cu && lu) return lu > cu ? localItem : cloudItem;
  return cloudItem;
}

export function mergeKey(cloudVal, localVal, tombstones = new Set()) {
  // Parse defensivo: nunca deixa um valor corrompido derrubar o merge nem
  // sobrescrever o lado íntegro com lixo.
  let cParsed, lParsed, cOk = true, lOk = true;
  try { cParsed = JSON.parse(cloudVal); } catch { cOk = false; }
  try { lParsed = JSON.parse(localVal); } catch { lOk = false; }

  if (!cOk) {
    // Nuvem corrompida: JAMAIS sobrescreve o local — preserva o que já existe.
    console.error('[cloudSync] mergeKey: valor da nuvem corrompido — mantendo local');
    return lOk ? localVal : (typeof localVal === 'string' ? localVal : '[]');
  }
  if (!lOk) {
    // Local corrompido: usa a nuvem íntegra.
    console.error('[cloudSync] mergeKey: valor local corrompido — usando nuvem');
    return cloudVal;
  }

  try {
    if (Array.isArray(cParsed) && Array.isArray(lParsed)) {
      // Detecta se é array de objetos com ID (transações) ou array de primitivos (categorias)
      const firstItem = cParsed[0] ?? lParsed[0];
      if (firstItem == null || typeof firstItem !== 'object') {
        // Arrays de strings/primitivos (categorias): retorna a união preservando adições locais
        return JSON.stringify([...new Set([...cParsed, ...lParsed])]);
      }
      // Arrays de objetos com ID: filtra tombstones e mescla
      const cFiltered = cParsed.filter(item => item.id && !tombstones.has(String(item.id)));
      const lFiltered = lParsed.filter(item => item.id && !tombstones.has(String(item.id)));
      const localById = new Map(lFiltered.map(item => [String(item.id), item]));
      const cloudIds  = new Set(cFiltered.map(item => String(item.id)));
      // Itens compartilhados: resolve por updatedAt (nuvem vence em empate/legado)
      const shared = cFiltered.map(cItem => {
        const lItem = localById.get(String(cItem.id));
        return lItem ? resolveItemConflict(cItem, lItem) : cItem;
      });
      // Itens só locais (ainda não enviados à nuvem): sempre preservados
      const onlyLocal = lFiltered.filter(item => !cloudIds.has(String(item.id)));
      return JSON.stringify([...shared, ...onlyLocal]);
    }
    // Objetos simples (ex: financeiro_efetivacoes): união de chaves; local sobrescreve conflitos
    if (cParsed && typeof cParsed === 'object' && !Array.isArray(cParsed) &&
        lParsed && typeof lParsed === 'object' && !Array.isArray(lParsed)) {
      return JSON.stringify({ ...cParsed, ...lParsed });
    }
  } catch (err) {
    console.error('[cloudSync] mergeKey: falha ao mesclar — usando fallback:', err?.message ?? err);
  }
  return (cloudVal && cloudVal !== '[]' && cloudVal !== 'null') ? cloudVal : localVal;
}

// Deduplica o processamento da nuvem: realtime e polling podem trazer a mesma linha.
// Retorna true se o updated_at recebido é mais novo que o último já aplicado.
export function isNewerCloud(lastTs, incomingTs) {
  if (!incomingTs) return true;   // sem carimbo (linha legada): processa
  if (!lastTs) return true;
  return incomingTs > lastTs;
}

export function applyCloudData(data) {
  if (!data || Object.keys(data).length === 0) return;

  // 1. Mescla tombstones da nuvem para o local (propaga deleções de outros dispositivos)
  DATA_KEYS.forEach(key => {
    const cloudTomb = data[key + TOMB];
    if (cloudTomb) {
      try { addTombstones(key, JSON.parse(cloudTomb)); }
      catch (err) { console.error('[cloudSync] tombstone da nuvem corrompido para', key, err?.message ?? err); }
    }
  });

  // 2. Aplica dados com filtragem de tombstones.
  //    Cada chave é isolada: uma falha em A nunca impede B de sincronizar.
  let changed = false;
  DATA_KEYS.forEach(key => {
    try {
      const cloudVal = data[key];
      if (cloudVal === undefined) return;
      // Chave foi modificada localmente e o push ainda não rodou — não sobrescreve
      if (dirtyKeys.has(key)) return;
      const localVal = safeGet(key);
      const tombstones = getTombstones(key);
      let merged;
      if (localVal) {
        merged = mergeKey(cloudVal, localVal, tombstones);
      } else {
        // Sem dado local: usa nuvem filtrando tombstones
        try {
          const arr = JSON.parse(cloudVal);
          merged = Array.isArray(arr) && tombstones.size
            ? JSON.stringify(arr.filter(item => !tombstones.has(String(item.id))))
            : cloudVal;
        } catch (err) {
          // Valor da nuvem corrompido e sem local: não grava lixo e não bloqueia as demais chaves.
          console.error('[cloudSync] applyCloudData: valor da nuvem corrompido para', key, '— ignorando chave:', err?.message ?? err);
          return;
        }
      }
      // Nunca sobrescreve dado existente com array vazio
      if (merged !== localVal && merged !== '[]') {
        safeSet(key, merged);
        changed = true;
      }
    } catch (err) {
      console.error('[cloudSync] applyCloudData: falha ao processar', key, '— seguindo com as demais:', err?.message ?? err);
    }
  });
  if (changed) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('planeje-sync'));
    broadcast();
  }
}

async function autoSyncCycle(userId) {
  try {
    const res = await runResilient(() => supabase.from('user_data')
      .select('data, updated_at').eq('user_id', userId).maybeSingle());
    const row = res?.data;
    if (row?.data && Object.keys(row.data).length > 0 && isNewerCloud(lastAppliedCloudTs, row.updated_at)) {
      lastAppliedCloudTs = row.updated_at || lastAppliedCloudTs;
      applyCloudData(row.data);
      console.log('[cloudSync] pull concluído');
    }
  } catch (err) {
    if (handleSyncError(err) === 'stop') { haltSyncCycle(); return; }
  }
  await lightPushToCloud(userId);
}

export async function pullFromCloud(userId) {
  try {
    const res = await runResilient(() => supabase.from('user_data')
      .select('data, updated_at').eq('user_id', userId).maybeSingle());
    const row = res?.data;
    if (row?.data && Object.keys(row.data).length > 0) {
      lastAppliedCloudTs = row.updated_at || lastAppliedCloudTs;
      applyCloudData(row.data);
      console.log('[cloudSync] pull concluído');
    }
  } catch (err) {
    if (handleSyncError(err) === 'stop') { haltSyncCycle(); return; }
  }
  try {
    const snap = snapshotLocal();
    if (Object.keys(snap).length > 0) {
      await archiveCurrentCloud(userId);
      await runResilient(() => supabase.from('user_data')
        .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }));
      console.log('[cloudSync] push concluído —', Object.keys(snap).length, 'chaves');
    }
  } catch (err) {
    if (handleSyncError(err) === 'stop') haltSyncCycle();
  }
}

// Cria (ou recria) o canal de Realtime e monitora sua saúde: em CHANNEL_ERROR/
// TIMED_OUT, remove o canal e reagenda a reconexão.
export function setupRealtime(userId) {
  realtimeChannel = supabase.channel(`user_data_${userId}`)
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'user_data', filter: `user_id=eq.${userId}` },
      (payload) => {
        const ts = payload.new?.updated_at;
        if (payload.new?.data && isNewerCloud(lastAppliedCloudTs, ts)) {
          lastAppliedCloudTs = ts || lastAppliedCloudTs;
          applyCloudData(payload.new.data);
        }
      })
    .on('system', {}, (status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[cloudSync] Realtime desconectado, reconectando...');
        try { supabase.removeChannel(realtimeChannel); } catch {}
        realtimeChannel = null;
        setTimeout(() => { if (currentUserId) setupRealtime(currentUserId); }, 3000);
      }
    })
    .subscribe();
}

export function startCloudSync(userId) {
  currentUserId = userId;
  if (unpatch) return;

  localStorage.setItem = (key, value) => {
    if (DATA_KEYS.includes(key)) {
      // Detecta itens deletados e registra tombstones antes de escrever
      try {
        const prevVal = safeGet(key);
        const prevArr = JSON.parse(prevVal || '[]');
        const newArr  = JSON.parse(value);
        if (Array.isArray(prevArr) && Array.isArray(newArr)) {
          const newIds  = new Set(newArr.map(i => i.id));
          const deleted = prevArr.filter(i => i.id && !newIds.has(i.id)).map(i => i.id);
          if (deleted.length) addTombstones(key, deleted);
        }
      } catch {}
    }
    safeSet(key, value);
    if (DATA_KEYS.includes(key) && currentUserId) {
      dirtyKeys.add(key);
      schedulePush(currentUserId);
      broadcast(); // avisa outras abas do mesmo navegador para recarregarem
    }
  };
  unpatch = () => { localStorage.setItem = _native; };

  // BroadcastChannel: CustomEvent só chega na própria aba. Isto propaga o
  // 'planeje-sync' para as demais abas do mesmo navegador.
  if (typeof BroadcastChannel !== 'undefined' && !bc) {
    bc = new BroadcastChannel('planeje-sync');
    bc.onmessage = () => {
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('planeje-sync'));
    };
  }

  if (!realtimeChannel) setupRealtime(userId);

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && currentUserId) {
      autoSyncCycle(currentUserId).catch(err => console.error('[cloudSync] autoSyncCycle falhou:', err?.message ?? err));
    } else if (document.visibilityState === 'hidden' && currentUserId) {
      // Push imediato ao ocultar (celular bloqueado, troca de app, aba fechada).
      lightPushToCloud(currentUserId).catch(err => console.error('[cloudSync] push ao ocultar falhou:', err?.message ?? err));
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  visibilityCleanup = () => document.removeEventListener('visibilitychange', onVisibility);

  // Ao reconectar, empurra imediatamente o que foi editado offline.
  const onOnline = () => { if (currentUserId) lightPushToCloud(currentUserId); };
  window.addEventListener('online', onOnline);
  onlineCleanup = () => window.removeEventListener('online', onOnline);

  // Snapshot automático de backup a cada 30 min durante a sessão ativa.
  if (!archiveInterval) {
    archiveInterval = setInterval(() => {
      if (currentUserId) archiveCurrentCloud(currentUserId).catch(() => {});
    }, 30 * 60 * 1000);
  }

  if (!pollInterval) {
    pollInterval = setInterval(() => {
      if (currentUserId) {
        console.debug('[cloudSync] polling tick');
        autoSyncCycle(currentUserId);
      }
    }, 5000);
  }
}

export async function stopCloudSync(finalPush = false) {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  // Push final limitado a 5s: se travar (rede/celular bloqueado), o logout segue
  // mesmo assim — nunca bloqueia o usuário indefinidamente.
  if (finalPush && currentUserId) {
    try { await withTimeout(pushToCloud(currentUserId), 5000); }
    catch (err) { console.error('[cloudSync] push final falhou/timeout — prosseguindo com logout:', err?.message ?? err); }
  }
  if (unpatch) { unpatch(); unpatch = null; }
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (visibilityCleanup) { visibilityCleanup(); visibilityCleanup = null; }
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
  if (bc) { try { bc.close(); } catch {} bc = null; }
  if (onlineCleanup) { onlineCleanup(); onlineCleanup = null; }
  if (archiveInterval) { clearInterval(archiveInterval); archiveInterval = null; }
  lastAppliedCloudTs = null;
  dirtyKeys.clear();
  currentUserId = null;
}

export function clearLocalData() {
  DATA_KEYS.forEach(key => {
    try {
      localStorage.removeItem(key);
      localStorage.removeItem(key + TOMB);
    } catch (err) {
      console.error('[cloudSync] clearLocalData falhou para', key, err?.message ?? err);
    }
  });
}
