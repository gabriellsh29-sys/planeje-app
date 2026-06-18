import { generateRegistrationOptions } from '@simplewebauthn/server';
import { checkOrigin, requireAuthUser, rateLimit } from './_security.js';
import { supabaseAdmin, rpName, rpID, saveChallenge } from './_webauthn.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  if (!checkOrigin(req, res)) return;
  if (!rateLimit(req, res, { key: 'webauthn-reg-opts', limit: 10, windowMs: 60_000 })) return;

  const user = await requireAuthUser(req, res);
  if (!user) return;

  try {
    const { data: existing } = await supabaseAdmin
      .from('webauthn_credentials')
      .select('credential_id')
      .eq('user_id', user.id);

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(user.id),
      userName: user.email,
      attestationType: 'none',
      excludeCredentials: (existing || []).map(c => ({ id: c.credential_id })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
        authenticatorAttachment: 'platform',
      },
    });

    await saveChallenge(user.email, options.challenge);

    res.status(200).json(options);
  } catch (err) {
    console.error('[webauthn-register-options]', err.message);
    res.status(500).json({ error: 'Erro ao iniciar cadastro do Face ID.' });
  }
}
