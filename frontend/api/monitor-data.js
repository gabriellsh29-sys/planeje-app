import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // Vercel envia Authorization: Bearer CRON_SECRET automaticamente nos crons
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '');
  if (token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Não autorizado' });
  }

  try {
    const { data: rows, error } = await supabase.rpc('fn_usuarios_dados_finos');
    if (error) throw error;

    if (!rows || rows.length === 0) {
      console.log('[monitor] todos os dados saudáveis');
      return res.status(200).json({ ok: true, afetados: 0 });
    }

    const lista = rows
      .map(r => `• ${r.nome || r.user_id} — ${r.chars} chars — ${new Date(r.updated_at).toLocaleDateString('pt-BR')}`)
      .join('\n');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Planeje Monitor <onboarding@resend.dev>',
        to: 'gabriellsh29@gmail.com',
        subject: `[Planeje] ⚠️ ${rows.length} usuário(s) com dados suspeitos`,
        html: `<h2>⚠️ Alerta: dados finos detectados</h2>
<p>Os seguintes usuários têm menos de 500 chars em user_data:</p>
<pre style="background:#f5f5f5;padding:12px;border-radius:8px">${lista}</pre>
<p>Acesse o Supabase e verifique se é necessário restaurar backup de <code>user_data_history</code>.</p>`,
      }),
    });

    console.log('[monitor] alerta enviado —', rows.length, 'afetados');
    return res.status(200).json({ ok: true, afetados: rows.length });
  } catch (err) {
    console.error('[monitor]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
