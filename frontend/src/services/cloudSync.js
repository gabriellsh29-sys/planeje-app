import { supabase } from '../lib/supabaseClient';
import { DATA_KEYS } from '../data/demoData';

// Guarda o setItem nativo antes de qualquer patch
const _native = localStorage.setItem.bind(localStorage);

let pushTimer      = null;
let currentUserId  = null;
let unpatch        = null;
let realtimeChannel = null;

function snapshotLocal() {
  const snap = {};
  DATA_KEYS.forEach(key => {
    const val = localStorage.getItem(key);
    if (val !== null) snap[key] = val;
  });
  return snap;
}

async function pushToCloud(userId) {
  const data = snapshotLocal();
  await supabase
    .from('user_data')
    .upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
}

function schedulePush(userId) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushToCloud(userId), 1500);
}

// Aplica dados da nuvem sem disparar novo push (usa setItem nativo)
function applyCloudData(data) {
  DATA_KEYS.forEach(key => {
    if (data[key] !== undefined) _native(key, data[key]);
    else localStorage.removeItem(key);
  });
}

export async function pullFromCloud(userId) {
  const { data: row } = await supabase
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();

  if (row?.data && Object.keys(row.data).length > 0) {
    applyCloudData(row.data);
  } else {
    // Primeiro acesso: envia o que houver localmente
    await pushToCloud(userId);
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

  // Realtime: recebe atualizações feitas em outros dispositivos
  if (!realtimeChannel) {
    realtimeChannel = supabase
      .channel(`user_data_${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_data', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (payload.new?.data) applyCloudData(payload.new.data);
        }
      )
      .subscribe();
  }
}

export async function stopCloudSync(finalPush = false) {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (finalPush && currentUserId) await pushToCloud(currentUserId);
  if (unpatch) { unpatch(); unpatch = null; }
  if (realtimeChannel) { supabase.removeChannel(realtimeChannel); realtimeChannel = null; }
  currentUserId = null;
}

export function clearLocalData() {
  DATA_KEYS.forEach(key => localStorage.removeItem(key));
}
