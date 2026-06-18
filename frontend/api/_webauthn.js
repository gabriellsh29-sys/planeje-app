import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const rpName = 'Planeje';
export const rpID = 'planejeapp.com.br';
export const origin = 'https://www.planejeapp.com.br';

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutos (dá tempo de configurar biometria no aparelho se for a 1ª vez)

export async function saveChallenge(email, challenge) {
  const e = email.trim().toLowerCase();
  await supabaseAdmin.from('webauthn_challenges').delete().eq('email', e);
  const { error } = await supabaseAdmin.from('webauthn_challenges').insert({ email: e, challenge });
  if (error) console.error('[webauthn] erro ao salvar challenge', error.message);
}

export async function consumeChallenge(email) {
  const e = email.trim().toLowerCase();
  const { data, error } = await supabaseAdmin
    .from('webauthn_challenges')
    .select('id, challenge, created_at')
    .eq('email', e)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) console.error('[webauthn] erro ao buscar challenge', error.message);
  if (!data) return null;
  await supabaseAdmin.from('webauthn_challenges').delete().eq('id', data.id);

  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > CHALLENGE_TTL_MS) {
    console.error('[webauthn] challenge expirado, idade(ms)=', age);
    return null;
  }

  return data.challenge;
}
