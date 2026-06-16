import { createClient } from '@supabase/supabase-js';
import { checkOrigin, requireAuthUser, rateLimit } from './_security.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, { key: 'delete-account', limit: 3, windowMs: 60_000 })) return;

  const user = await requireAuthUser(req, res);
  if (!user) return;

  try {
    // Apaga dados do usuário antes de apagar a conta
    await supabase.from('user_data').delete().eq('user_id', user.id);
    await supabase.from('perfis').delete().eq('id', user.id);

    // Apaga a conta de autenticação via admin
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw error;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[delete-account]', err.message);
    res.status(500).json({ error: 'Erro ao excluir conta. Tente novamente ou contate o suporte.' });
  }
}
