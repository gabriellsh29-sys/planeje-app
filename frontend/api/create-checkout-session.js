import Stripe from 'stripe';
import { checkOrigin, requireAuthUser, rateLimit } from './_security.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const ALLOWED_PRICES = [process.env.VITE_STRIPE_PRICE_MENSAL, process.env.VITE_STRIPE_PRICE_ANUAL].filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, { key: 'checkout', limit: 10, windowMs: 60_000 })) return;

  const { priceId, userId } = req.body || {};
  if (!priceId || !userId) return res.status(400).json({ error: 'Dados inválidos' });
  if (!ALLOWED_PRICES.includes(priceId)) return res.status(400).json({ error: 'Plano inválido' });

  const user = await requireAuthUser(req, res);
  if (!user) return;
  if (user.id !== userId) return res.status(401).json({ error: 'Não autorizado' });

  try {
    const BASE = 'https://www.planejeapp.com.br';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: userId,
      success_url: `${BASE}/?pagamento=sucesso`,
      cancel_url: `${BASE}/?pagamento=cancelado`,
    });
    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[checkout]', err.message);
    res.status(500).json({ error: 'Erro ao iniciar pagamento. Tente novamente.' });
  }
}
