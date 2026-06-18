import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { checkOrigin, rateLimit } from './_security.js';
import { supabaseAdmin, rpID, origin, consumeChallenge } from './_webauthn.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, { key: 'webauthn-login-verify', limit: 10, windowMs: 60_000 })) return;

  const { email, assertionResponse } = req.body || {};
  if (!email || !assertionResponse) return res.status(400).json({ error: 'Dados inválidos' });

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const expectedChallenge = await consumeChallenge(normalizedEmail);
    if (!expectedChallenge) return res.status(400).json({ error: 'Login expirado, tente novamente.' });

    const { data: cred } = await supabaseAdmin
      .from('webauthn_credentials')
      .select('id, user_id, public_key, counter')
      .eq('credential_id', assertionResponse.id)
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!cred) return res.status(401).json({ error: 'Não autorizado' });

    const verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: assertionResponse.id,
        publicKey: Buffer.from(cred.public_key, 'base64'),
        counter: Number(cred.counter),
      },
    });

    if (!verification.verified) return res.status(401).json({ error: 'Não autorizado' });

    await supabaseAdmin
      .from('webauthn_credentials')
      .update({ counter: verification.authenticationInfo.newCounter })
      .eq('id', cred.id);

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: normalizedEmail,
    });
    if (linkErr) throw linkErr;

    res.status(200).json({
      email: normalizedEmail,
      token: linkData.properties.hashed_token,
    });
  } catch (err) {
    console.error('[webauthn-login-verify]', err.message);
    res.status(500).json({ error: 'Erro ao validar Face ID.' });
  }
}
