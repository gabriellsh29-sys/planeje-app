import { supabase } from '../lib/supabaseClient';
import { DATA_KEYS } from '../data/demoData';

// Guarda contra ambientes sem localStorage (SSR / testes em Node) — em navegador
// o comportamento é idêntico ao anterior.
const _hasLS      = typeof localStorage !== 'undefined';
const _native     = _hasLS ? localStorage.setItem.bind(localStorage) : () => {};
const _native_get = _hasLS ? localStorage.getItem.bind(localStorage) : () => null;

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

// Notifica outras abas (BroadcastChannel) que o localStorage mudou.
function broadcast() { try { bc?.postMessage('sync'); } catch {} }

// Chaves modificadas localmente aguardando push — protege contra o pull sobrescrever edições no debounce de 500ms
const dirtyKeys = new Set();

function getTombstones(key) {
  try { return new Set(JSON.parse(_native_get(key + TOMB) || '[]')); }
  catch { return new Set(); }
}

function addTombstones(key, ids) {
  if (!ids || !ids.length) return;
  const set = getTombstones(key);
  ids.forEach(id => set.add(id));
  _native(key + TOMB, JSON.stringify([...set]));
}

function snapshotLocal() {
  const snap = {};
  DATA_KEYS.forEach(key => {
    const val = _native_get(key);
    if (val !== null) snap[key] = val;
    const tomb = _native_get(key + TOMB);
    if (tomb && tomb !== '[]') snap[key + TOMB] = tomb;
  });
  return snap;
}

async function archiveCurrentCloud(userId) {
  try {
    const { data: row } = await supabase.from('user_data').select('data').eq('user_id', userId).maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0) {
      await supabase.from('user_data_history').insert({ user_id: userId, data: row.data });
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
  } catch (err) {
    console.error('[cloudSync] pushToCloud/upsert falhou:', err?.message ?? err);
  }
}

async function lightPushToCloud(userId) {
  const snap = snapshotLocal();
  if (Object.keys(snap).length === 0) return;
  try {
    const ts = new Date().toISOString();
    await supabase.from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: ts }, { onConflict: 'user_id' });
    // Registra nosso próprio push para o eco do realtime/polling não re-aplicar à toa.
    lastAppliedCloudTs = ts;
    dirtyKeys.clear();
  } catch (err) {
    console.error('[cloudSync] lightPushToCloud falhou:', err?.message ?? err);
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
  try {
    const cParsed = JSON.parse(cloudVal);
    const lParsed = JSON.parse(localVal);
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
  } catch {}
  return (cloudVal && cloudVal !== '[]' && cloudVal !== 'null') ? cloudVal : localVal;
}

// Deduplica o processamento da nuvem: realtime e polling podem trazer a mesma linha.
// Retorna true se o updated_at recebido é mais novo que o último já aplicado.
export function isNewerCloud(lastTs, incomingTs) {
  if (!incomingTs) return true;   // sem carimbo (linha legada): processa
  if (!lastTs) return true;
  return incomingTs > lastTs;
}

function applyCloudData(data) {
  if (!data || Object.keys(data).length === 0) return;

  // 1. Mescla tombstones da nuvem para o local (propaga deleções de outros dispositivos)
  DATA_KEYS.forEach(key => {
    const cloudTomb = data[key + TOMB];
    if (cloudTomb) {
      try { addTombstones(key, JSON.parse(cloudTomb)); } catch {}
    }
  });

  // 2. Aplica dados com filtragem de tombstones
  let changed = false;
  DATA_KEYS.forEach(key => {
    const cloudVal = data[key];
    if (cloudVal === undefined) return;
    // Chave foi modificada localmente e o push ainda não rodou — não sobrescreve
    if (dirtyKeys.has(key)) return;
    const localVal = _native_get(key);
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
      } catch { merged = cloudVal; }
    }
    // Nunca sobrescreve dado existente com array vazio
    if (merged !== localVal && merged !== '[]') {
      _native(key, merged);
      changed = true;
    }
  });
  if (changed) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('planeje-sync'));
    broadcast();
  }
}

async function autoSyncCycle(userId) {
  try {
    const { data: row } = await supabase.from('user_data').select('data, updated_at').eq('user_id', userId).maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0 && isNewerCloud(lastAppliedCloudTs, row.updated_at)) {
      lastAppliedCloudTs = row.updated_at || lastAppliedCloudTs;
      applyCloudData(row.data);
    }
  } catch (err) {
    console.error('[cloudSync] autoSyncCycle/pull falhou:', err?.message ?? err);
  }
  await lightPushToCloud(userId);
}

export async function pullFromCloud(userId) {
  try {
    const { data: row } = await supabase.from('user_data').select('data, updated_at').eq('user_id', userId).maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0) {
      lastAppliedCloudTs = row.updated_at || lastAppliedCloudTs;
      applyCloudData(row.data);
    }
  } catch (err) {
    console.error('[cloudSync] pullFromCloud/fetch falhou:', err?.message ?? err);
  }
  try {
    const snap = snapshotLocal();
    if (Object.keys(snap).length > 0) {
      await archiveCurrentCloud(userId);
      await supabase.from('user_data')
        .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    }
  } catch (err) {
    console.error('[cloudSync] pullFromCloud/push falhou:', err?.message ?? err);
  }
}

export function startCloudSync(userId) {
  currentUserId = userId;
  if (unpatch) return;

  localStorage.setItem = (key, value) => {
    if (DATA_KEYS.includes(key)) {
      // Detecta itens deletados e registra tombstones antes de escrever
      try {
        const prevVal = _native_get(key);
        const prevArr = JSON.parse(prevVal || '[]');
        const newArr  = JSON.parse(value);
        if (Array.isArray(prevArr) && Array.isArray(newArr)) {
          const newIds  = new Set(newArr.map(i => i.id));
          const deleted = prevArr.filter(i => i.id && !newIds.has(i.id)).map(i => i.id);
          if (deleted.length) addTombstones(key, deleted);
        }
      } catch {}
    }
    _native(key, value);
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

  if (!realtimeChannel) {
    realtimeChannel = supabase.channel(`user_data_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_data', filter: `user_id=eq.${userId}` },
        (payload) => {
          const ts = payload.new?.updated_at;
          if (payload.new?.data && isNewerCloud(lastAppliedCloudTs, ts)) {
            lastAppliedCloudTs = ts || lastAppliedCloudTs;
            applyCloudData(payload.new.data);
          }
        })
      .subscribe();
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && currentUserId) autoSyncCycle(currentUserId).catch(() => {});
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
      if (currentUserId) autoSyncCycle(currentUserId);
    }, 5000);
  }
}

export async function stopCloudSync(finalPush = false) {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (finalPush && currentUserId) await pushToCloud(currentUserId);
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
    localStorage.removeItem(key);
    localStorage.removeItem(key + TOMB);
  });
}
