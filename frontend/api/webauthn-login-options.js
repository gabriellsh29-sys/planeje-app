import crypto from 'crypto';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { checkOrigin, rateLimit } from './_security.js';
import { supabaseAdmin, rpID, saveChallenge } from './_webauthn.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!(await rateLimit(req, res, { key: 'webauthn-login-opts', limit: 15, windowMs: 60_000 }))) return;

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Informe o e-mail' });

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const { data: creds } = await supabaseAdmin
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('email', normalizedEmail);

    // Sem credencial real: gera opções com um ID de credencial falso (aleatório) em
    // vez de responder com um erro distinto. Isso evita enumeração de e-mail — quem
    // observa só a rede não consegue diferenciar "e-mail sem Face ID" de "e-mail com
    // Face ID": nos dois casos a resposta tem o mesmo formato (200 + opções). No
    // navegador do lado de quem NÃO tem credencial, o WebAuthn simplesmente não acha
    // nada correspondente e falha localmente — o mesmo erro genérico que o front-end
    // já mostra pra qualquer outra falha (ele nunca exibe a mensagem de erro do
    // backend nesse fluxo).
    const allowCredentials = (creds && creds.length > 0)
      ? creds.map(c => ({ id: c.credential_id }))
      : [{ id: crypto.randomBytes(32).toString('base64url') }];

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials,
    });

    await saveChallenge(normalizedEmail, options.challenge);

    res.status(200).json(options);
  } catch (err) {
    console.error('[webauthn-login-options]', err.message);
    res.status(500).json({ error: 'Erro ao iniciar login com Face ID.' });
  }
}
