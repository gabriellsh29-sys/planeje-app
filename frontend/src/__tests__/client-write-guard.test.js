/**
 * Planeje — Client Write Guard (regressão estática)
 * Framework: Vitest
 *
 * Não testa comportamento em runtime — varre o CÓDIGO FONTE em busca de
 * padrões perigosos que já causaram (ou quase causaram) bypass de paywall:
 * o cliente (browser, com a anon key) atualizando colunas de billing
 * diretamente via supabase-js.
 *
 * Isso é uma rede de segurança: mesmo que o RLS do banco esteja correto hoje
 * (auditoria de 21-22/09/2026), se um dia alguém no código do app adicionar
 * `.from('perfis').update({ plano: ... })` do lado do cliente, este teste
 * quebra ANTES de chegar em produção — sem precisar de banco nem de rede.
 *
 * Cobertura:
 *  1. Nenhuma chamada .from('perfis').update(...) no código do CLIENTE (src/)
 *     grava campos de billing (plano, assinatura_status, trial_expira_em,
 *     stripe_customer_id, stripe_subscription_id).
 *  2. As chamadas de update em 'perfis' existentes só usam nome/avatar_url.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve(__dirname, '..');
const BILLING_FIELDS = ['plano', 'assinatura_status', 'trial_expira_em', 'stripe_customer_id', 'stripe_subscription_id'];

function listJsxFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...listJsxFiles(full));
    } else if (/\.(jsx?|tsx?)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('Client Write Guard — perfis (billing) nunca é gravado pelo cliente', () => {
  const files = listJsxFiles(SRC_DIR);

  it('1. Nenhum arquivo em src/ contém .from(\'perfis\').update com campo de billing', () => {
    const ofensores = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      // Acha cada bloco "from('perfis')...update({ ... })" (não perfeito, mas
      // suficiente pra pegar objetos literais na mesma linha/poucas linhas —
      // que é como o código real está escrito hoje).
      const regex = /from\(['"]perfis['"]\)[\s\S]{0,20}?\.update\(\s*\{([\s\S]{0,300}?)\}\s*\)/g;
      let m;
      while ((m = regex.exec(content))) {
        const bodyOfUpdate = m[1];
        for (const field of BILLING_FIELDS) {
          if (new RegExp(`\\b${field}\\b`).test(bodyOfUpdate)) {
            ofensores.push(`${path.relative(SRC_DIR, file)}: grava campo de billing "${field}" em perfis pelo cliente`);
          }
        }
      }
    }
    expect(ofensores).toEqual([]);
  });

  it('2. As chamadas de update em perfis hoje usam apenas nome/avatar_url', () => {
    const usados = new Set();
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const regex = /from\(['"]perfis['"]\)[\s\S]{0,20}?\.update\(\s*\{([\s\S]{0,300}?)\}\s*\)/g;
      let m;
      while ((m = regex.exec(content))) {
        const fields = [...m[1].matchAll(/(\w+)\s*:/g)].map(x => x[1]);
        fields.forEach(f => usados.add(f));
      }
    }
    // Garante que o teste realmente encontrou pelo menos uma chamada (senão o
    // teste 1 passaria trivialmente por não achar nada — falso positivo).
    expect(usados.size).toBeGreaterThan(0);
    for (const campo of usados) {
      expect(['nome', 'avatar_url']).toContain(campo);
    }
  });
});
