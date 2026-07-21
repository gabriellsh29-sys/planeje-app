import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { checkOrigin, requireAuthUser, rateLimit } from './_security.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, { key: 'portal', limit: 10, windowMs: 60_000 })) return;

  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'Dados inválidos' });

  const user = await requireAuthUser(req, res);
  if (!user) return;
  if (user.id !== userId) return res.status(401).json({ error: 'Não autorizado' });

  // Usa o token do próprio usuário — RLS permite ler o próprio perfil sem service role key
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  try {
    const { data: perfil, error } = await supabase.from('perfis').select('stripe_customer_id').eq('id', userId).maybeSingle();
    if (error) throw error;
    if (!perfil?.stripe_customer_id) return res.status(400).json({ error: 'Nenhuma assinatura encontrada' });

    const session = await stripe.billingPortal.sessions.create({
      customer: perfil.stripe_customer_id,
      return_url: 'https://www.planejeapp.com.br/?perfil=1',
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[portal]', err.message);
    res.status(500).json({ error: 'Erro ao abrir portal. Tente novamente.' });
  }
}
