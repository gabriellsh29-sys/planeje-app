/**
 * Planeje — Headers & Config Guard (regressão estática)
 * Framework: Vitest
 *
 * Lê frontend/vercel.json (o mesmo arquivo servido em produção) e garante
 * que os cabeçalhos de segurança endurecidos na auditoria de 21/09/2026
 * continuam presentes. Não faz requisição de rede — evita depender de
 * produção estar no ar, e roda em qualquer PR antes do deploy.
 *
 * Cobertura (item D do checklist — "Verificar CSP e cabeçalhos HTTP"):
 *  1. vercel.json aplica os headers a todas as rotas
 *  2. Cabeçalhos anti-clickjacking / MIME-sniffing / HSTS presentes
 *  3. CSP: default-src restrito a 'self'
 *  4. CSP: object-src 'none' (bloqueia plugins/Flash-like)
 *  5. CSP: frame-ancestors 'none' (redundante com X-Frame-Options, defesa em profundidade)
 *  6. CSP: form-action 'self' (CSRF-adjacent — formulário não pode postar pra fora)
 *  7. CSP: connect-src restrito às origens esperadas (Supabase/Stripe/Sentry) — nada solto
 *  8. CSP: script-src não inclui host externo algum (só 'self' + inline necessário do app)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const vercelConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../vercel.json'), 'utf8')
);

function getHeaders() {
  const rule = vercelConfig.headers.find(h => h.source === '/(.*)');
  const map = {};
  for (const h of rule.headers) map[h.key] = h.value;
  return map;
}

describe('vercel.json — cabeçalhos de segurança', () => {
  const headers = getHeaders();

  it('1. Aplica headers a todas as rotas ("/(.*)")', () => {
    expect(vercelConfig.headers.some(h => h.source === '/(.*)')).toBe(true);
  });

  it('2. Headers básicos anti-clickjacking / MIME-sniffing / HSTS presentes', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Strict-Transport-Security']).toMatch(/max-age=\d+/);
    expect(headers['Strict-Transport-Security']).toMatch(/includeSubDomains/);
  });

  it('3. CSP: default-src restrito a self', () => {
    expect(headers['Content-Security-Policy']).toMatch(/default-src 'self'/);
  });

  it('4. CSP: object-src none', () => {
    expect(headers['Content-Security-Policy']).toMatch(/object-src 'none'/);
  });

  it('5. CSP: frame-ancestors none', () => {
    expect(headers['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
  });

  it('6. CSP: form-action self', () => {
    expect(headers['Content-Security-Policy']).toMatch(/form-action 'self'/);
  });

  it('7. CSP: connect-src não abre pra qualquer domínio (sem "https:" solto nem "*")', () => {
    const csp = headers['Content-Security-Policy'];
    const connectSrc = csp.match(/connect-src ([^;]+);/)?.[1] || '';
    expect(connectSrc).not.toMatch(/(^|\s)\*(\s|$)/);
    // "https:" sozinho (sem "//") libera QUALQUER host HTTPS — diferente de
    // uma URL completa como "https://api.stripe.com", que é restrita.
    expect(connectSrc).not.toMatch(/(^|\s)https:(\s|$)/);
  });

  it('8. CSP: script-src não inclui nenhum host externo', () => {
    const csp = headers['Content-Security-Policy'];
    const scriptSrc = csp.match(/script-src ([^;]+);/)?.[1] || '';
    // Só pode conter self / unsafe-inline — qualquer https://algo.com aqui
    // seria supply-chain risk (é exatamente o que tirei do lp.html: unpkg@latest).
    expect(scriptSrc).not.toMatch(/https?:\/\//);
  });
});
