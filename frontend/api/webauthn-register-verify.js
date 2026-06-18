import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { checkOrigin, requireAuthUser, rateLimit } from './_security.js';
import { supabaseAdmin, rpID, origin, consumeChallenge } from './_webauthn.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, { key: 'webauthn-reg-verify', limit: 10, windowMs: 60_000 })) return;

  const user = await requireAuthUser(req, res);
  if (!user) return;

  const { attestationResponse, deviceName } = req.body || {};
  if (!attestationResponse) return res.status(400).json({ error: 'Dados inválidos' });

  try {
    const expectedChallenge = await consumeChallenge(user.email);
    if (!expectedChallenge) return res.status(400).json({ error: 'Cadastro expirado, tente novamente.' });

    const verification = await verifyRegistrationResponse({
      response: attestationResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Não foi possível confirmar o dispositivo.' });
    }

    const { credential } = verification.registrationInfo;

    await supabaseAdmin.from('webauthn_credentials').insert({
      user_id: user.id,
      email: user.email,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      device_name: (deviceName || 'Dispositivo').slice(0, 60),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webauthn-register-verify]', err.message);
    res.status(500).json({ error: 'Erro ao confirmar cadastro do Face ID.' });
  }
}
