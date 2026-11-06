/**
 * Planeje — Detecção de projeto Supabase restrito (402)
 * Garante o contrato FAIL-OPEN: só HTTP 402 vira "indisponível"; qualquer outra
 * resposta, falha de rede, timeout ou configuração ausente NÃO pode trancar o app.
 */
import { describe, it, expect, vi } from 'vitest';
import { projetoRestrito } from '../lib/servicoIndisponivel';

const URL_SB = 'https://exemplo.supabase.co';
const KEY = 'sb_publishable_teste';

const respondeCom = (status) => vi.fn().mockResolvedValue({ status });

describe('projetoRestrito', () => {
  it('402 => restrito', async () => {
    const f = respondeCom(402);
    expect(await projetoRestrito({ fetchImpl: f, url: URL_SB, key: KEY })).toBe(true);
  });

  it('chama /auth/v1/health com a apikey e sem usar cache', async () => {
    const f = respondeCom(200);
    await projetoRestrito({ fetchImpl: f, url: URL_SB + '/', key: KEY });
    const [endereco, opcoes] = f.mock.calls[0];
    expect(endereco).toBe('https://exemplo.supabase.co/auth/v1/health');
    expect(opcoes.headers.apikey).toBe(KEY);
    expect(opcoes.cache).toBe('no-store');
  });

  it.each([200, 204, 401, 403, 404, 429, 500, 502, 503])('%i => NÃO restrito (fail-open)', async (status) => {
    expect(await projetoRestrito({ fetchImpl: respondeCom(status), url: URL_SB, key: KEY })).toBe(false);
  });

  it('erro de rede => NÃO restrito', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await projetoRestrito({ fetchImpl: f, url: URL_SB, key: KEY })).toBe(false);
  });

  it('timeout => NÃO restrito e a requisição é abortada', async () => {
    let sinal;
    const f = vi.fn((_u, { signal }) => new Promise((_res, rej) => {
      sinal = signal;
      signal.addEventListener('abort', () => rej(new DOMException('abortado', 'AbortError')));
    }));
    const r = await projetoRestrito({ fetchImpl: f, url: URL_SB, key: KEY, timeoutMs: 20 });
    expect(r).toBe(false);
    expect(sinal.aborted).toBe(true);
  });

  it('sem URL ou sem chave => NÃO restrito e nem chama a rede', async () => {
    const f = respondeCom(402);
    expect(await projetoRestrito({ fetchImpl: f, url: '', key: KEY })).toBe(false);
    expect(await projetoRestrito({ fetchImpl: f, url: URL_SB, key: '' })).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
