import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'Dados inválidos' });

  try {
    const { data: perfil, error } = await supabase.from('perfis').select('stripe_customer_id').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!perfil?.stripe_customer_id) return res.status(400).json({ error: 'Nenhuma assinatura encontrada' });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: perfil.stripe_customer_id,
      return_url: `${origin}/?perfil=1`,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
