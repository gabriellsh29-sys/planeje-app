import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { checkOrigin, requireAuthUser, rateLimit } from './_security.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, { key: 'delete-account', limit: 3, windowMs: 60_000 })) return;

  const user = await requireAuthUser(req, res);
  if (!user) return;

  try {
    // Cancela a assinatura no Stripe antes de apagar os dados (evita cobrança após exclusão)
    const { data: perfil } = await supabase.from('perfis').select('stripe_subscription_id').eq('id', user.id).maybeSingle();
    if (perfil?.stripe_subscription_id) {
      try {
        await stripe.subscriptions.cancel(perfil.stripe_subscription_id);
      } catch (stripeErr) {
        console.error('[delete-account] erro ao cancelar assinatura Stripe', stripeErr.message);
      }
    }

    // Apaga dados financeiros e perfil
    await supabase.from('user_data').delete().eq('user_id', user.id);
    await supabase.from('perfis').delete().eq('id', user.id);

    // Apaga avatar do storage (LGPD — exclusão completa dos dados)
    await supabase.storage.from('avatars').remove([`${user.id}/avatar.jpg`]);

    // Apaga a conta de autenticação via admin
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw error;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[delete-account]', err.message);
    res.status(500).json({ error: 'Erro ao excluir conta. Tente novamente ou contate o suporte.' });
  }
}
