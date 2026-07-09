import { supabase } from '../lib/supabaseClient';
import { DATA_KEYS } from '../data/demoData';

const _native = localStorage.setItem.bind(localStorage);

let pushTimer         = null;
let currentUserId     = null;
let unpatch           = null;
let realtimeChannel   = null;
let visibilityCleanup = null;
let pollInterval      = null;

function snapshotLocal() {
  const snap = {};
  DATA_KEYS.forEach(key => {
    const val = localStorage.getItem(key);
    if (val !== null) snap[key] = val;
  });
  return snap;
}

async function archiveCurrentCloud(userId) {
  try {
    const { data: row } = await supabase
      .from('user_data')
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0) {
      await supabase.from('user_data_history').insert({ user_id: userId, data: row.data });
    }
  } catch {}
}

async function pushToCloud(userId) {
  const snap = snapshotLocal();
  if (Object.keys(snap).length === 0) return; // REGRA 1: nunca envia vazio
  try { await archiveCurrentCloud(userId); } catch {}
  try {
    await supabase
      .from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() });
  } catch {}
}

function schedulePush(userId) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushToCloud(userId), 1500);
}

function mergeKey(cloudVal, localVal) {
  try {
    const cArr = JSON.parse(cloudVal);
    const lArr = JSON.parse(localVal);
    if (Array.isArray(cArr) && Array.isArray(lArr)) {
      const cloudIds = new Set(cArr.map(item => item.id));
      const onlyLocal = lArr.filter(item => !cloudIds.has(item.id));
      return JSON.stringify([...cArr, ...onlyLocal]);
    }
  } catch {}
  return (cloudVal && cloudVal !== '[]' && cloudVal !== 'null') ? cloudVal : localVal;
}

// REGRA 2+3: payload vazio ignorado; sempre mescla, nunca sobrescreve
function applyCloudData(data) {
  if (!data || Object.keys(data).length === 0) return;
  let changed = false;
  DATA_KEYS.forEach(key => {
    const cloudVal = data[key];
    if (cloudVal === undefined) return;
    const localVal = localStorage.getItem(key);
    const merged = localVal ? mergeKey(cloudVal, localVal) : cloudVal;
    if (merged !== localVal) {
      _native(key, merged);
      changed = true;
    }
  });
  if (changed) window.dispatchEvent(new CustomEvent('planeje-sync'));
}

// Puxa sem fazer push-back — usado no polling para não criar writes excessivos
async function softPullFromCloud(userId) {
  try {
    const { data: row } = await supabase
      .from('user_data')
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0) {
      applyCloudData(row.data);
    }
  } catch {}
}

// Pull completo: aplica nuvem → depois empurra snapshot local completo de volta
export async function pullFromCloud(userId) {
  try {
    const { data: row } = await supabase
      .from('user_data')
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();
    if (row?.data && Object.keys(row.data).length > 0) {
      applyCloudData(row.data);
    }
  } catch {}
  try {
    const snap = snapshotLocal();
    if (Object.keys(snap).length > 0) {
      await archiveCurrentCloud(userId);
      await supabase
        .from('user_data')
        .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() });
    }
  } catch {}
}

export function startCloudSync(userId) {
  currentUserId = userId;
  if (unpatch) return; // já ativo

  localStorage.setItem = (key, value) => {
    _native(key, value);
    if (DATA_KEYS.includes(key) && currentUserId) schedulePush(currentUserId);
  };
  unpatch = () => { localStorage.setItem = _native; };

  if (!realtimeChannel) {
    realtimeChannel = supabase
      .channel(`user_data_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_data', filter: `user_id=eq.${userId}` },
        (payload) => { if (payload.new?.data) applyCloudData(payload.new.data); }
      )
      .subscribe();
  }

  // Fallback visibilitychange: re-puxa quando app volta ao foco
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && currentUserId) {
      pullFromCloud(currentUserId).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  visibilityCleanup = () => document.removeEventListener('visibilitychange', onVisibility);

  // Polling a cada 30s: garante sync mesmo se Realtime falhar
  if (!pollInterval) {
    pollInterval = setInterval(() => {
      if (currentUserId) softPullFromCloud(currentUserId);
    }, 30000);
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
  DATA_KEYS.forEach(key => localStorage.removeItem(key));
}

// Exporta para uso manual (ex: botão "Sincronizar")
export async function forceSyncNow(userId) {
  if (!userId) return;
  await pullFromCloud(userId);
  const snap = snapshotLocal();
  if (Object.keys(snap).length > 0) {
    await supabase
      .from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() });
  }
}
