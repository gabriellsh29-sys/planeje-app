import { supabase } from '../lib/supabaseClient';
import { DATA_KEYS } from '../data/demoData';

let pushTimer = null;
let currentUserId = null;
let unpatch = null;

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
  await supabase.from('user_data').upsert({ user_id: userId, data, updated_at: new Date().toISOString() });
}

function schedulePush(userId) {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushToCloud(userId), 1500);
}

// Busca os dados do usuário na nuvem e aplica no localStorage.
// Se o usuário ainda não tem nada salvo na nuvem (primeiro acesso),
// envia o que já existir localmente (ex: dados de demonstração).
export async function pullFromCloud(userId) {
  const { data: row } = await supabase.from('user_data').select('data').eq('user_id', userId).maybeSingle();
  if (row?.data && Object.keys(row.data).length > 0) {
    DATA_KEYS.forEach(key => {
      if (row.data[key] !== undefined) localStorage.setItem(key, row.data[key]);
      else localStorage.removeItem(key);
    });
  } else {
    await pushToCloud(userId);
  }
}

// Passa a sincronizar qualquer alteração nas chaves do app com a nuvem.
export function startCloudSync(userId) {
  currentUserId = userId;
  if (unpatch) return; // já ativo
  const original = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    original(key, value);
    if (DATA_KEYS.includes(key) && currentUserId) schedulePush(currentUserId);
  };
  unpatch = () => { localStorage.setItem = original; };
}

export async function stopCloudSync(finalPush = false) {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  if (finalPush && currentUserId) await pushToCloud(currentUserId);
  if (unpatch) { unpatch(); unpatch = null; }
  currentUserId = null;
}

// Limpa os dados locais do usuário anterior (evita "vazamento" entre contas no mesmo navegador)
export function clearLocalData() {
  DATA_KEYS.forEach(key => localStorage.removeItem(key));
}
