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
        html: `<p><strong>Erro no webhook do Stripe:</strong></p><pre>${String(detalhes).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
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

  // Idempotência por event.id: a Stripe reentrega o MESMO evento em retries
  // (timeout, 5xx nosso, rede). Sem isto, qualquer efeito futuro que não seja
  // um simples UPDATE idempotente (ex.: enviar e-mail, incrementar contador)
  // rodaria de novo a cada reentrega. Se já processamos este event.id com
  // sucesso, respondemos 200 sem refazer nada.
  const { data: jaProcessado, error: dedupCheckError } = await supabase
    .from('stripe_processed_events')
    .select('event_id')
    .eq('event_id', event.id)
    .maybeSingle();

  if (dedupCheckError) {
    // Se a checagem de duplicata falhar (ex.: tabela indisponível), preferimos
    // seguir e processar o evento (fail-open aqui) a nunca aplicar uma
    // assinatura paga por causa de um erro transitório nesta tabela auxiliar —
    // o pior caso é reprocessar um evento já visto, que já é idempotente na
    // prática (ver notas abaixo).
    console.error('[webhook] falha ao checar deduplicação de evento (seguindo mesmo assim):', dedupCheckError.message);
  } else if (jaProcessado) {
    console.log('[webhook] evento já processado anteriormente, ignorando duplicata:', event.id);
    return res.status(200).json({ received: true, duplicate: true });
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

    // O payload do evento é uma FOTO do momento em que o evento foi gerado —
    // com eventos concorrentes/fora de ordem, confiar cegamente nele é
    // ambíguo mesmo com a guarda de timestamp abaixo (ela só decide "aplica
    // ou não", não corrige o VALOR se dois eventos diferentes chegam quase
    // juntos). Consultamos a Stripe pelo estado ATUAL da assinatura — a
    // fonte da verdade — e gravamos esse valor, não o do snapshot do evento.
    // Se a consulta falhar (rede, assinatura removida etc.), caímos pro
    // status do próprio evento como melhor esforço.
    let statusStripe = sub.status;
    try {
      const assinaturaAtual = await stripe.subscriptions.retrieve(sub.id);
      statusStripe = assinaturaAtual.status;
    } catch (fetchErr) {
      console.error('[webhook] falha ao consultar estado atual da assinatura na Stripe, usando snapshot do evento:', fetchErr.message);
    }
    const status = statusStripe === 'active' || statusStripe === 'trialing' ? 'ativa' : 'inativa';

    // A Stripe não garante ordem de entrega dos webhooks (retries/rede podem
    // reentregar um evento antigo depois de um mais novo já processado). Esta
    // guarda por timestamp é uma segunda camada de defesa (além da consulta
    // acima): só aplica a atualização se este evento for mais novo ou empatar
    // com o último já aplicado a esta linha (ou se nunca houve um antes) —
    // eventos estritamente mais antigos são ignorados.
    const eventTs = new Date(event.created * 1000).toISOString();
    const { error } = await supabase.from('perfis')
      .update({ assinatura_status: status, stripe_last_event_at: eventTs })
      .eq('stripe_subscription_id', sub.id)
      .or(`stripe_last_event_at.is.null,stripe_last_event_at.lte.${eventTs}`);

    if (error) {
      console.error('[webhook] erro ao atualizar assinatura:', error.message);
      await notificarErro(event.type, `subscription_id: ${sub.id}\nStatus: ${status}\nErro: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }
  }

  // Só marca o evento como processado DEPOIS de todo o trabalho ter sido
  // concluído sem erro — se algo acima falhou, já retornamos 500 antes de
  // chegar aqui, e a Stripe vai reentregar (o dedup acima não vai encontrar
  // este event_id, então o retry processa de verdade).
  const { error: dedupInsertError } = await supabase
    .from('stripe_processed_events')
    .insert({ event_id: event.id, type: event.type });
  if (dedupInsertError && dedupInsertError.code !== '23505') { // 23505 = já existe (corrida entre retries) — ok ignorar
    console.error('[webhook] falha ao registrar evento como processado (não bloqueante):', dedupInsertError.message);
  }

  res.status(200).json({ received: true });
}
