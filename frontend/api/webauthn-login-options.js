import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { checkOrigin, rateLimit } from './_security.js';
import { supabaseAdmin, rpID, saveChallenge } from './_webauthn.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, { key: 'webauthn-login-opts', limit: 15, windowMs: 60_000 })) return;

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Informe o e-mail' });

  try {
    const { data: creds } = await supabaseAdmin
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('email', email.trim().toLowerCase());

    if (!creds || creds.length === 0) {
      return res.status(400).json({ error: 'Face ID não configurado para este e-mail.' });
    }

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: creds.map(c => ({ id: c.credential_id })),
    });

    await saveChallenge(email.trim().toLowerCase(), options.challenge);

    res.status(200).json(options);
  } catch (err) {
    console.error('[webauthn-login-options]', err.message);
    res.status(500).json({ error: 'Erro ao iniciar login com Face ID.' });
  }
}
