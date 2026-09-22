import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const config = { api: { bodyParser: false } };

// Tempo máximo razoável pra este handler terminar de processar um evento
// (inclui, no pior caso, uma chamada extra à API da Stripe). Usado só pra
// decidir se uma reivindicação "processing" travada há mais tempo que isso
// pode ser considerada abandonada (processo anterior morreu no meio) e
// retomada por uma nova tentativa — nunca pra decidir se um evento recente
// concorrente pode ser reprocessado.
const CLAIM_STALE_MS = 2 * 60 * 1000;

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

// Reivindica event.id de forma ATÔMICA via INSERT (a exclusividade vem da
// PRIMARY KEY do Postgres, não de "consultar antes de inserir" — duas
// entregas simultâneas do mesmo evento não podem as duas vencer o INSERT).
//
// Retorna:
//   { ok: true }                         — reivindicado; processe o evento e
//                                           chame finishEvent(event, sucesso)
//                                           ao final, sempre.
//   { ok: false, reason: 'duplicate' }    — já foi processado com sucesso
//                                           antes; responda 200 sem refazer.
//   { ok: false, reason: 'concurrent' }   — outra entrega está processando
//                                           ESTE evento agora (ou reivindicou
//                                           há pouco tempo); responda algo
//                                           retryable, NUNCA processe aqui.
//   { ok: false, reason: 'infra', ... }   — não deu pra garantir exclusividade
//                                           (tabela indisponível etc.); trate
//                                           como indisponibilidade temporária,
//                                           NUNCA processe sem essa garantia.
async function claimEvent(event) {
  const { error: insertErr } = await supabase
    .from('stripe_processed_events')
    .insert({ event_id: event.id, type: event.type, status: 'processing' });

  if (!insertErr) return { ok: true };
  if (insertErr.code !== '23505') return { ok: false, reason: 'infra', detalhe: insertErr.message };

  // event_id já existe — outra tentativa (concorrente, ou uma anterior) já
  // reivindicou. Consulta o estado dela pra decidir o que fazer.
  const { data: existente, error: selectErr } = await supabase
    .from('stripe_processed_events')
    .select('status, processed_at')
    .eq('event_id', event.id)
    .maybeSingle();

  if (selectErr || !existente) {
    return { ok: false, reason: 'infra', detalhe: selectErr?.message || 'linha de dedup não encontrada logo após conflito de chave' };
  }

  if (existente.status === 'completed') {
    return { ok: false, reason: 'duplicate' };
  }

  const idadeMs = Date.now() - new Date(existente.processed_at).getTime();
  if (idadeMs < CLAIM_STALE_MS) {
    // Está "processing" e é recente demais pra presumir que travou — pode
    // ser uma entrega concorrente processando ESTE MESMO evento agora mesmo.
    // Não processamos aqui (evitaria duplicar o efeito); pedimos retry.
    return { ok: false, reason: 'concurrent' };
  }

  // "processing" há mais tempo que o razoável pra este handler terminar —
  // presume-se que a tentativa anterior morreu (timeout/crash) sem limpar
  // sua própria reivindicação. Retoma, mas de forma condicional (o próprio
  // UPDATE só afeta a linha se ela CONTINUAR "processing" no momento exato
  // da escrita — se outra retomada venceu a corrida entre o SELECT acima e
  // este UPDATE, .select() abaixo volta vazio e nós desistimos).
  const { data: retomado, error: reclaimErr } = await supabase
    .from('stripe_processed_events')
    .update({ status: 'processing', processed_at: new Date().toISOString() })
    .eq('event_id', event.id)
    .eq('status', 'processing')
    .select('event_id');

  if (reclaimErr) return { ok: false, reason: 'infra', detalhe: reclaimErr.message };
  if (!retomado || retomado.length === 0) return { ok: false, reason: 'concurrent' };
  return { ok: true };
}

// Fecha a reivindicação: 'completed' fica registrado pra sempre (dedup real
// de futuras reentregas); em falha, a linha é APAGADA — sem isso, uma
// tentativa que falhou no meio ficaria "processing" pra sempre e bloquearia
// qualquer reprocessamento futuro deste event.id (inclusive o retry legítimo
// da própria Stripe).
async function finishEvent(event, sucesso) {
  if (sucesso) {
    const { error } = await supabase.from('stripe_processed_events').update({ status: 'completed' }).eq('event_id', event.id);
    if (error) console.error('[webhook] falha ao marcar evento como concluído (não bloqueante):', error.message);
  } else {
    const { error } = await supabase.from('stripe_processed_events').delete().eq('event_id', event.id);
    if (error) console.error('[webhook] falha ao limpar reivindicação após erro (não bloqueante):', error.message);
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

  const claim = await claimEvent(event);
  if (!claim.ok) {
    if (claim.reason === 'duplicate') {
      console.log('[webhook] evento já processado anteriormente, ignorando duplicata:', event.id);
      return res.status(200).json({ received: true, duplicate: true });
    }
    // 'concurrent' ou 'infra': não há garantia de exclusividade — NUNCA
    // processamos sem ela. 409/503 são status retryable; a Stripe reentrega.
    console.error('[webhook] não foi possível garantir exclusividade do processamento, pedindo retry:', event.id, claim.reason, claim.detalhe || '');
    return res.status(claim.reason === 'concurrent' ? 409 : 503).json({ error: 'try_again_later' });
  }

  try {
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
          await finishEvent(event, false);
          return res.status(500).json({ error: error.message });
        }
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;

      // O payload do evento é uma FOTO do momento em que o evento foi gerado.
      // Consultamos a Stripe pelo estado ATUAL da assinatura — a fonte da
      // verdade — em vez de confiar nesse snapshot, porque eventos
      // concorrentes/fora de ordem podem deixá-lo desatualizado. Se a
      // consulta falhar, NÃO usamos o snapshot como "melhor esforço": isso
      // arriscaria mudar o acesso do usuário com base em informação que já
      // sabemos que pode estar errada. Em vez disso, devolvemos um erro
      // temporário e deixamos a Stripe reentregar o evento mais tarde.
      let assinaturaAtual;
      try {
        assinaturaAtual = await stripe.subscriptions.retrieve(sub.id);
      } catch (fetchErr) {
        console.error('[webhook] falha ao consultar estado atual da assinatura na Stripe:', fetchErr.message);
        await notificarErro(event.type, `subscription_id: ${sub.id}\nFalha ao consultar Stripe (retry pendente): ${fetchErr.message}`);
        await finishEvent(event, false);
        return res.status(503).json({ error: 'stripe_unavailable_retry_later' });
      }
      const status = assinaturaAtual.status === 'active' || assinaturaAtual.status === 'trialing' ? 'ativa' : 'inativa';

      // A Stripe não garante ordem de entrega dos webhooks. Esta guarda por
      // timestamp é uma segunda camada de defesa (além da consulta acima):
      // só aplica a atualização se este evento for mais novo ou empatar com
      // o último já aplicado a esta linha (ou se nunca houve um antes) —
      // eventos estritamente mais antigos são ignorados.
      const eventTs = new Date(event.created * 1000).toISOString();
      const { error } = await supabase.from('perfis')
        .update({ assinatura_status: status, stripe_last_event_at: eventTs })
        .eq('stripe_subscription_id', sub.id)
        .or(`stripe_last_event_at.is.null,stripe_last_event_at.lte.${eventTs}`);

      if (error) {
        console.error('[webhook] erro ao atualizar assinatura:', error.message);
        await notificarErro(event.type, `subscription_id: ${sub.id}\nStatus: ${status}\nErro: ${error.message}`);
        await finishEvent(event, false);
        return res.status(500).json({ error: error.message });
      }
    }

    await finishEvent(event, true);
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] erro inesperado processando evento:', err.message);
    await notificarErro(event.type, `event_id: ${event.id}\nErro inesperado: ${err.message}`);
    await finishEvent(event, false);
    res.status(500).json({ error: 'unexpected_error' });
  }
}
