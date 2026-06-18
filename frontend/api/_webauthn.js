import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const rpName = 'Planeje';
export const rpID = 'planejeapp.com.br';
export const origin = 'https://www.planejeapp.com.br';

const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutos

export async function saveChallenge(email, challenge) {
  await supabaseAdmin.from('webauthn_challenges').delete().eq('email', email);
  await supabaseAdmin.from('webauthn_challenges').insert({ email, challenge });
}

export async function consumeChallenge(email) {
  const { data } = await supabaseAdmin
    .from('webauthn_challenges')
    .select('id, challenge, created_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  await supabaseAdmin.from('webauthn_challenges').delete().eq('id', data.id);

  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > CHALLENGE_TTL_MS) return null;

  return data.challenge;
}
