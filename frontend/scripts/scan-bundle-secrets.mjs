#!/usr/bin/env node
/**
 * Planeje — Scan de segredos no bundle público (item D do checklist de
 * segurança: "Confirmar ausência de segredos no bundle público").
 *
 * Roda DEPOIS de `npm run build` e varre tudo que vai pro navegador do
 * usuário (dist/) atrás de padrões de chave secreta. Não precisa de rede,
 * não precisa de credenciais reais — só olha o texto do build.
 *
 * Uso:
 *   npm run build && node scripts/scan-bundle-secrets.mjs
 *
 * Sai com código 1 (falha CI) se achar algo.
 */
import fs from 'fs';
import path from 'path';

const DIST = path.resolve(process.cwd(), 'dist');

const PATTERNS = [
  { name: 'Stripe secret key',        re: /sk_(live|test)_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe webhook secret',    re: /whsec_[A-Za-z0-9]{10,}/ },
  { name: 'Resend API key',           re: /re_[A-Za-z0-9_]{16,}/ },
  { name: 'AWS access key',           re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private key (PEM)',        re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  // Supabase service_role JWT tem um payload com "role":"service_role" —
  // diferente da anon key (role":"anon"), que É esperada e pública no bundle.
  { name: 'Supabase service_role JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, extra: (match, content) => {
      try {
        const [, payloadB64] = match[0].split('.');
        const payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        return payload.role === 'service_role';
      } catch { return false; }
    } },
  { name: 'CRON_SECRET literal',      re: /CRON_SECRET['"]?\s*[:=]\s*['"][A-Za-z0-9+/=]{16,}['"]/ },
];

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (/\.(js|css|html|map)$/.test(entry.name)) out.push(full);
  }
  return out;
}

if (!fs.existsSync(DIST)) {
  console.error(`[scan-bundle-secrets] dist/ não existe. Rode "npm run build" primeiro.`);
  process.exit(2);
}

let achou = false;
for (const file of listFiles(DIST)) {
  const content = fs.readFileSync(file, 'utf8');
  for (const { name, re, extra } of PATTERNS) {
    const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = globalRe.exec(content))) {
      if (extra && !extra(m, content)) continue; // ex.: JWT de anon key, que é esperado
      achou = true;
      console.error(`[scan-bundle-secrets] ${name} encontrado em ${path.relative(process.cwd(), file)}`);
    }
  }
}

if (achou) {
  console.error('\n[scan-bundle-secrets] FALHOU — segredo(s) encontrado(s) no bundle público.');
  process.exit(1);
}
console.log('[scan-bundle-secrets] OK — nenhum segredo conhecido encontrado em dist/.');
