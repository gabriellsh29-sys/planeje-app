import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

async function notificarErro(assunto, detalhes) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Planeje App <onboarding@resend.dev>',
        to: 'gabriellsh29@gmail.com',
        subject: `[Planeje] Erro no webhook: ${assunto}`,
        html: `<p><strong>Erro no webhook do Stripe:</strong></p><pre>${detalhes}</pre>`,
      }),
    });
  } catch (e) {
    console.error('[webhook] falha ao enviar e-mail de erro:', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing signature');

  const buf = await buffer(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    if (userId) {
      const { error } = await supabase.from('perfis').update({
        plano: 'pago',
        assinatura_status: 'ativa',
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription,
      }).eq('id', userId);

      if (error) {
        console.error('[webhook] erro ao atualizar perfil:', error.message);
        await notificarErro('checkout.session.completed', `userId: ${userId}\nEmail: ${session.customer_details?.email}\nErro: ${error.message}`);
        return res.status(500).json({ error: error.message });
      }
    }
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    const status = sub.status === 'active' || sub.status === 'trialing' ? 'ativa' : 'inativa';

    const { error } = await supabase.from('perfis').update({ assinatura_status: status })
      .eq('stripe_subscription_id', sub.id);

    if (error) {
      console.error('[webhook] erro ao atualizar assinatura:', error.message);
      await notificarErro(event.type, `subscription_id: ${sub.id}\nStatus: ${status}\nErro: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
  }

  res.status(200).json({ received: true });
}
