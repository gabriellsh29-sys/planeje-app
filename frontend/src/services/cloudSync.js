import { supabase } from '../lib/supabaseClient';
import { DATA_KEYS } from '../data/demoData';

const _native     = localStorage.setItem.bind(localStorage);
const _native_get = localStorage.getItem.bind(localStorage);

// Tombstones: registram IDs de itens deletados para propagar deleções entre dispositivos
const TOMB = '__tomb';

let pushTimer         = null;
let currentUserId     = null;
let unpatch           = null;
let realtimeChannel   = null;
let visibilityCleanup = null;
let pollInterval      = null;

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
    }
  } catch {}
}

async function pushToCloud(userId) {
  const snap = snapshotLocal();
  if (Object.keys(snap).length === 0) return;
  try { await archiveCurrentCloud(userId); } catch {}
  try {
    await supabase.from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch {}
}

async function lightPushToCloud(userId) {
  const snap = snapshotLocal();
  if (Object.keys(snap).length === 0) return;
  try {
    await supabase.from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch {}
}

function schedulePush(userId) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => lightPushToCloud(userId), 500);
}

function mergeKey(cloudVal, localVal, tombstones = new Set()) {
  try {
    const cArr = JSON.parse(cloudVal);
    const lArr = JSON.parse(localVal);
    if (Array.isArray(cArr) && Array.isArray(lArr)) {
      // Detecta se é array de objetos com ID (transações) ou array de primitivos (categorias)
      const firstItem = cArr[0] ?? lArr[0];
      if (firstItem == null || typeof firstItem !== 'object') {
        // Arrays de strings/primitivos (categorias): retorna a união preservando adições locais
        return JSON.stringify([...new Set([...cArr, ...lArr])]);
      }
      // Arrays de objetos com ID: filtra tombstones e mescla
      const cFiltered = cArr.filter(item => item.id && !tombstones.has(item.id));
      const lFiltered = lArr.filter(item => item.id && !tombstones.has(item.id));
      const cloudIds = new Set(cFiltered.map(item => item.id));
      const onlyLocal = lFiltered.filter(item => !cloudIds.has(item.id));
      return JSON.stringify([...cFiltered, ...onlyLocal]);
    }
  } catch {}
  return (cloudVal && cloudVal !== '[]' && cloudVal !== 'null') ? cloudVal : localVal;
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
          ? JSON.stringify(arr.filter(item => !tombstones.has(item.id)))
          : cloudVal;
      } catch { merged = cloudVal; }
    }
    // Nunca sobrescreve dado existente com array vazio
    if (merged !== localVal && merged !== '[]') {
      _native(key, merged);
      changed = true;
    }
  });
  if (changed) window.dispatchEvent(new CustomEvent('planeje-sync'));
}

async function autoSyncCycle(userId) {
  try {
    const { data: row } = await supabase.from('user_data').select('data').eq('user_id', userId).maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0) {
      applyCloudData(row.data);
    }
  } catch {}
  await lightPushToCloud(userId);
}

export async function pullFromCloud(userId) {
  try {
    const { data: row } = await supabase.from('user_data').select('data').eq('user_id', userId).maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0) {
      applyCloudData(row.data);
    }
  } catch {}
  try {
    const snap = snapshotLocal();
    if (Object.keys(snap).length > 0) {
      await archiveCurrentCloud(userId);
      await supabase.from('user_data')
        .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    }
  } catch {}
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
    if (DATA_KEYS.includes(key) && currentUserId) schedulePush(currentUserId);
  };
  unpatch = () => { localStorage.setItem = _native; };

  if (!realtimeChannel) {
    realtimeChannel = supabase.channel(`user_data_${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_data', filter: `user_id=eq.${userId}` },
        (payload) => { if (payload.new?.data) applyCloudData(payload.new.data); })
      .subscribe();
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && currentUserId) autoSyncCycle(currentUserId).catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisibility);
  visibilityCleanup = () => document.removeEventListener('visibilitychange', onVisibility);

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
  currentUserId = null;
}

export function clearLocalData() {
  DATA_KEYS.forEach(key => {
    localStorage.removeItem(key);
    localStorage.removeItem(key + TOMB);
  });
}
