import { supabase } from '../lib/supabaseClient';
import { DATA_KEYS } from '../data/demoData';

const _native = localStorage.setItem.bind(localStorage);

let pushTimer        = null;
let currentUserId    = null;
let unpatch          = null;
let realtimeChannel  = null;
let visibilityCleanup = null;

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
      await supabase.from('user_data_history').insert({
        user_id: userId,
        data: row.data,
      });
    }
  } catch {}
}

async function pushToCloud(userId) {
  const snap = snapshotLocal();
  // REGRA 1: Nunca envia snapshot vazio — evita wipe acidental
  if (Object.keys(snap).length === 0) return;
  await archiveCurrentCloud(userId);
  await supabase
    .from('user_data')
    .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() });
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

// REGRA 2: Nunca apaga dados locais — sempre mescla.
// REGRA 3: Payload vazio da nuvem é ignorado completamente.
function applyCloudData(data) {
  if (!data || Object.keys(data).length === 0) return;
  DATA_KEYS.forEach(key => {
    const cloudVal = data[key];
    if (cloudVal === undefined) return;
    const localVal = localStorage.getItem(key);
    if (!localVal) {
      _native(key, cloudVal);
    } else {
      _native(key, mergeKey(cloudVal, localVal));
    }
  });
  // Avisa todos os componentes React para recarregarem do localStorage
  window.dispatchEvent(new CustomEvent('planeje-sync'));
}

export async function pullFromCloud(userId) {
  const { data: row } = await supabase
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();

  // Aplica dados da nuvem ao local (merge sem apagar nada)
  if (row?.data && Object.keys(row.data).length > 0) {
    applyCloudData(row.data);
  }

  // Sempre empurra o snapshot local completo para a nuvem.
  // Garante que a nuvem tenha TODAS as chaves do usuário, mesmo que
  // apenas parte delas estivesse salva anteriormente.
  const snap = snapshotLocal();
  if (Object.keys(snap).length > 0) {
    await archiveCurrentCloud(userId);
    await supabase
      .from('user_data')
      .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() });
  }
}

export function startCloudSync(userId) {
  currentUserId = userId;
  if (unpatch) return; // já ativo

  // Intercepta localStorage.setItem para disparar push automático
  localStorage.setItem = (key, value) => {
    _native(key, value);
    if (DATA_KEYS.includes(key) && currentUserId) schedulePush(currentUserId);
  };
  unpatch = () => { localStorage.setItem = _native; };

  // Realtime: escuta INSERT e UPDATE para garantir que o primeiro push
  // de qualquer dispositivo seja recebido por todos os outros
  if (!realtimeChannel) {
    realtimeChannel = supabase
      .channel(`user_data_${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_data', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.new?.data) applyCloudData(payload.new.data);
        }
      )
      .subscribe();
  }

  // Fallback: quando o app volta ao foco (ex: mobile em background),
  // re-puxa da nuvem para garantir que dados não ficaram desatualizados
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && currentUserId) {
      pullFromCloud(currentUserId).catch(() => {});
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  visibilityCleanup = () => document.removeEventListener('visibilitychange', onVisibility);
}

export async function stopCloudSync(finalPush = false) {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (finalPush && currentUserId) await pushToCloud(currentUserId);
  if (unpatch) { unpatch(); unpatch = null; }
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  if (visibilityCleanup) { visibilityCleanup(); visibilityCleanup = null; }
  currentUserId = null;
}

export function clearLocalData() {
  DATA_KEYS.forEach(key => localStorage.removeItem(key));
}
