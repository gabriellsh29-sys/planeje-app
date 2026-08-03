import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_ORIGINS = [
  'https://www.planejeapp.com.br',
  'https://planejeapp.com.br',
];

export function checkOrigin(req, res) {
  const origin = req.headers.origin;
  // Exige o header Origin (não só valida quando presente): navegadores sempre o
  // enviam em requisições POST/fetch, mesmo same-origin. Só falta em chamadas
  // feitas fora do navegador (curl/Postman/script direto) — exatamente o que essa
  // checagem deve barrar. Sem essa exigência, qualquer chamada de servidor pra
  // servidor pulava a checagem por completo.
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'Origem não permitida' });
    return false;
  }
  return true;
}

export async function requireAuthUser(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) {
    res.status(401).json({ error: 'Não autorizado' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Não autorizado' });
    return null;
  }
  return data.user;
}

// Rate limit em memória — usado só como fallback (ver rateLimit abaixo) se a
// checagem via banco (compartilhada entre instâncias) não estiver disponível.
// Sozinho, em memória por instância, não protege de verdade em serverless: cada
// instância/cold start tem seu próprio contador, então um atacante distribuindo
// requisições na prática não é limitado.
const hits = new Map();

// Limpa entradas expiradas a cada 5 minutos para evitar memory leak.
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of hits.entries()) {
    if (now - entry.start > 300_000) hits.delete(id);
  }
}, 300_000);

function rateLimitMemoryFallback(id, limit, windowMs) {
  const now = Date.now();
  const entry = hits.get(id);
  if (!entry || now - entry.start > windowMs) {
    hits.set(id, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

// Rate limit real, compartilhado entre todas as instâncias serverless, via uma
// função Postgres atômica (rate_limit_hit — ver frontend/supabase/rate-limiting.sql).
// Se a tabela/função ainda não existir no banco (migração não aplicada) ou o banco
// falhar pontualmente, cai pro limite em memória em vez de deixar a rota sem
// proteção nenhuma ou derrubar a requisição.
export async function rateLimit(req, res, { limit = 5, windowMs = 60_000, key = 'default' } = {}) {
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const id = `${key}:${ip}`;

  let allowed;
  try {
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_key: id, p_window_ms: windowMs, p_limit: limit,
    });
    if (error) throw error;
    allowed = !!data;
  } catch (err) {
    console.error('[rateLimit] banco indisponível, usando fallback em memória:', err?.message ?? err);
    allowed = rateLimitMemoryFallback(id, limit, windowMs);
  }

  if (!allowed) {
    res.status(429).json({ error: 'Muitas requisições. Tente novamente em breve.' });
    return false;
  }
  return true;
}
