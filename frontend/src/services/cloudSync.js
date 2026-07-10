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

// Push completo com arquivo histórico (usado no login e logout)
async function pushToCloud(userId) {
  const snap = snapshotLocal();
  if (Object.keys(snap).length === 0) return; // REGRA 1: nunca envia vazio
  try { await archiveCurrentCloud(userId); } catch {}
  try {
    await supabase
      .from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch {}
}

// Push leve sem arquivo (usado no polling e schedulePush — frequente)
async function lightPushToCloud(userId) {
  const snap = snapshotLocal();
  if (Object.keys(snap).length === 0) return; // REGRA 1
  try {
    await supabase
      .from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  } catch {}
}

// Timer de push reduzido para 500ms — dados chegam à nuvem quase imediatamente
function schedulePush(userId) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => lightPushToCloud(userId), 500);
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

// Ciclo de sync a cada 15s: pull da nuvem + push do local
// Garante sync automático mesmo se Realtime falhar ou push anterior tiver falhado
async function autoSyncCycle(userId) {
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
  // Depois do pull, empurra o snapshot local (que pode ter dados não enviados ainda)
  await lightPushToCloud(userId);
}

// Pull completo: aplica nuvem + empurra snapshot completo com arquivo
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
        .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
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

  // Fallback visibilitychange: full sync quando app volta ao foco (troca de aba/app)
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && currentUserId) {
      pullFromCloud(currentUserId).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  visibilityCleanup = () => document.removeEventListener('visibilitychange', onVisibility);

  // Polling bidirecional a cada 15s: pull + push leve
  // Garante que dados de qualquer dispositivo cheguem ao outro em ≤15s
  if (!pollInterval) {
    pollInterval = setInterval(() => {
      if (currentUserId) autoSyncCycle(currentUserId);
    }, 15000);
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
