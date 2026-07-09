import { supabase } from '../lib/supabaseClient';
import { DATA_KEYS } from '../data/demoData';

// Guarda o setItem nativo antes de qualquer patch
const _native = localStorage.setItem.bind(localStorage);

let pushTimer       = null;
let currentUserId   = null;
let unpatch         = null;
let realtimeChannel = null;

function snapshotLocal() {
  const snap = {};
  DATA_KEYS.forEach(key => {
    const val = localStorage.getItem(key);
    if (val !== null) snap[key] = val;
  });
  return snap;
}

// Arquiva o snapshot atual da nuvem antes de qualquer sobrescrita.
// Isso garante que sempre existe uma versão anterior recuperável.
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

// Mescla dois valores de uma chave.
// Para arrays: cloud vence nos registros existentes (mesmo id),
// registros que existem só localmente são preservados.
// Isso garante que nenhuma gravação remota apague dados locais.
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
  // Não-array: nuvem vence apenas se não estiver vazia
  return (cloudVal && cloudVal !== '[]' && cloudVal !== 'null') ? cloudVal : localVal;
}

// Aplica dados da nuvem sem disparar novo push (usa setItem nativo).
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
}

export async function pullFromCloud(userId) {
  const { data: row } = await supabase
    .from('user_data')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();

  if (row?.data && Object.keys(row.data).length > 0) {
    // Nuvem tem dados: mescla com local (preserva ambos)
    applyCloudData(row.data);
  } else {
    // Sem dados na nuvem: envia local apenas se não estiver vazio
    const snap = snapshotLocal();
    if (Object.keys(snap).length > 0) {
      await supabase
        .from('user_data')
        .upsert({ user_id: userId, data: snap, updated_at: new Date().toISOString() });
    }
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
