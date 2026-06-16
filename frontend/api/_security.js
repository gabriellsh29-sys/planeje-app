import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ALLOWED_ORIGINS = [
  'https://www.planejeapp.com.br',
  'https://planejeapp.com.br',
];

export function checkOrigin(req, res) {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
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

// Rate limiting simples em memória (por instância serverless).
// Não substitui uma solução distribuída, mas reduz abuso básico/bots.
const hits = new Map();

export function rateLimit(req, res, { limit = 5, windowMs = 60_000, key = 'default' } = {}) {
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const id = `${key}:${ip}`;
  const now = Date.now();
  const entry = hits.get(id);

  if (!entry || now - entry.start > windowMs) {
    hits.set(id, { start: now, count: 1 });
    return true;
  }

  entry.count += 1;
  if (entry.count > limit) {
    res.status(429).json({ error: 'Muitas requisições. Tente novamente em breve.' });
    return false;
  }
  return true;
}
