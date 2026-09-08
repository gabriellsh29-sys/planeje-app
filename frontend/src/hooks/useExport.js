const DIVIDA_KEY  = 'financeiro_dividas';
const RECEITA_KEY = 'financeiro_receitas';
const CARTAO_KEY  = 'planeje_cartoes';
const FATURA_KEY  = 'planeje_faturas';
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Mesma paleta categórica usada nos rankings da tela de Gráficos (Graficos.jsx)
// — mantém a identidade visual do app também no PDF exportado.
const CATEGORICAL_COLORS = ['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];

// Logo oficial do Planeje, embutida como SVG inline (não como <img src> pra um
// domínio externo) — garante que a marca sempre renderize no PDF/impressão,
// mesmo offline ou sem acesso à rede no momento de imprimir.
const LOGO_HORIZONTAL_WHITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="88 0 1112 360" height="96" style="display:block">
  <g transform="translate(60 34) scale(0.57)">
    <g fill="none" stroke="#FFFFFF" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
      <path d="M118 407 C75 407 58 377 58 336 L58 139 C58 92 92 58 139 58 L344 58 C391 58 424 92 424 139 L424 158"/>
      <path d="M126 298 C207 280 286 225 366 128"/>
      <path d="M326 128 L366 128 L366 168"/>
    </g>
    <g fill="#FFFFFF">
      <rect x="119" y="321" width="54" height="105" rx="23"/>
      <rect x="222" y="276" width="54" height="150" rx="23"/>
      <rect x="325" y="211" width="54" height="215" rx="23"/>
    </g>
  </g>
  <text x="375" y="190" font-family="Poppins, Arial, sans-serif" font-size="124" font-weight="600" letter-spacing="1" fill="#FFFFFF">planeje</text>
  <text x="382" y="253" font-family="Poppins, Arial, sans-serif" font-size="32" font-weight="700" letter-spacing="8" fill="#FFFFFF">SUAS FINANÇAS, SEU FUTURO.</text>
</svg>`;

const LOGO_ICON_GREEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" height="16" style="display:block">
  <g fill="none" stroke="#22C55E" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <path d="M118 407 C75 407 58 377 58 336 L58 139 C58 92 92 58 139 58 L344 58 C391 58 424 92 424 139 L424 158"/>
    <path d="M126 298 C207 280 286 225 366 128"/>
    <path d="M326 128 L366 128 L366 168"/>
  </g>
  <g fill="#22C55E">
    <rect x="119" y="321" width="54" height="105" rx="23"/>
    <rect x="222" y="276" width="54" height="150" rx="23"/>
    <rect x="325" y="211" width="54" height="215" rx="23"/>
  </g>
</svg>`;

function fmt(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0); }
function fmtDate(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return d || ''; } }
function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

function mesKey(month, year) { return `${year}-${String(month).padStart(2, '0')}`; }

// Para "fixa"/"parcelar", nome/valor/categoria podem variar por mês (overrides/
// historico) — mesmo mecanismo de Dividas.jsx/Receitas.jsx. Sem isso, um ajuste
// "somente este mês" não aparecia no relatório exportado.
function getCamposMes(d, month, year) {
  const base = { nome: d.nome, valor: d.valor, categoria: d.categoria };
  if (d.recorrencia !== 'fixa' && d.recorrencia !== 'parcelar') return base;
  const key = mesKey(month, year);
  if (d.overrides && d.overrides[key]) return { ...base, ...d.overrides[key] };
  if (d.historico && d.historico.length) {
    const found = d.historico.find(h => key <= h.ate);
    if (found) return { ...base, ...found };
  }
  return base;
}
function parcelaValorMes(d, month, year) {
  const campos = getCamposMes(d, month, year);
  if (d.recorrencia === 'parcelar' && d.totalParcelas > 1) return campos.valor / d.totalParcelas;
  return campos.valor;
}

// Status de pagamento por mês (mesma regra de Dividas.jsx): "fixa"/"parcelar" guardam
// o pagamento em d.pagamentos['YYYY-MM'], com fallback pro campo legado global.
function statusMes(d, month, year) {
  if (d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') {
    const key = mesKey(month, year);
    const p = d.pagamentos && d.pagamentos[key];
    if (p) return { pago: !!p.pago, valorPago: p.valorPago ?? null };
    if (d.recorrencia === 'parcelar' && d.pago && d.pagamentoData) {
      const [py, pm] = d.pagamentoData.split('-').map(Number);
      if (py === year && pm === month) return { pago: true, valorPago: d.valorPago ?? null };
    }
    return { pago: false, valorPago: null };
  }
  return { pago: !!d.pago, valorPago: d.valorPago ?? null };
}

// Idem, para receitas (mesma regra de Receitas.jsx): r.recebimentos['YYYY-MM'].
function statusMesReceita(r, month, year) {
  if (r.recorrencia === 'fixa' || r.recorrencia === 'parcelar') {
    const key = mesKey(month, year);
    const p = r.recebimentos && r.recebimentos[key];
    if (p) return { recebida: !!p.recebida, valorRecebido: p.valorRecebido || null };
    if (r.recorrencia === 'parcelar' && r.recebida && r.recebimentoData) {
      const [ry, rm] = r.recebimentoData.split('-').map(Number);
      if (ry === year && rm === month) return { recebida: true, valorRecebido: r.valorRecebido || null };
    }
    return { recebida: false, valorRecebido: null };
  }
  return { recebida: !!r.recebida, valorRecebido: r.valorRecebido || null };
}

// Idem, para receitas.
function getCamposMesReceita(r, month, year) {
  const base = { nome: r.nome, valor: r.valor, categoria: r.categoria };
  if (r.recorrencia !== 'fixa' && r.recorrencia !== 'parcelar') return base;
  const key = mesKey(month, year);
  if (r.overrides && r.overrides[key]) return { ...base, ...r.overrides[key] };
  if (r.historico && r.historico.length) {
    const found = r.historico.find(h => key <= h.ate);
    if (found) return { ...base, ...found };
  }
  return base;
}
function parcelaValorMesReceita(r, month, year) {
  const campos = getCamposMesReceita(r, month, year);
  if (r.recorrencia === 'parcelar' && r.totalParcelas > 1) return campos.valor / r.totalParcelas;
  return campos.valor;
}

// Receitas parceladas guardam a data-base em r.data (não r.vencimento como despesas).
function parcelaAbrangeMsReceita(r, month, year) {
  if (!r.data) return false;
  const [ry, rm] = r.data.split('-').map(Number);
  const inicio = ry * 12 + (rm - 1);
  const fim = inicio + ((r.totalParcelas || 1) - 1);
  return (year * 12 + (month - 1)) >= inicio && (year * 12 + (month - 1)) <= fim;
}

function getDespesas(month, year) {
  try {
    const all = JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]');
    return all.filter(d => {
      if (d.recorrencia === 'fixa') {
        if (!d.vencimento) return true;
        const [vy, vm] = d.vencimento.split('-').map(Number);
        return (year * 12 + month - 1) >= (vy * 12 + vm - 1);
      }
      if (d.recorrencia === 'parcelar') {
        if (!d.vencimento) return false;
        const [vy, vm] = d.vencimento.split('-').map(Number);
        const inicio = vy * 12 + vm - 1;
        const fim = inicio + (d.totalParcelas || 1) - 1;
        const atual = year * 12 + month - 1;
        return atual >= inicio && atual <= fim;
      }
      const ds = d.pagamentoData || d.vencimento;
      if (!ds) return false;
      const [y, m] = ds.split('-').map(Number);
      return y === year && m === month;
    });
  } catch { return []; }
}

// Nomes de campo corretos: receitas usam `data`/`recebimentoData`/`recebida`/
// `valorRecebido` — NÃO `dataBase`/`dataRecebimento`/`recebido`/`valorConfirmado`,
// que nunca existiram nos objetos reais e faziam o relatório sair sempre errado
// (fixas apareciam em todo mês, únicas/parceladas nunca apareciam, status sempre
// "A receber").
function getReceitas(month, year) {
  try {
    const all = JSON.parse(localStorage.getItem(RECEITA_KEY) || '[]');
    return all.filter(r => {
      if (r.recorrencia === 'fixa') {
        if (!r.data) return true;
        const [ry, rm] = r.data.split('-').map(Number);
        return (year * 12 + month - 1) >= (ry * 12 + rm - 1);
      }
      if (r.recorrencia === 'parcelar') return parcelaAbrangeMsReceita(r, month, year);
      const ds = r.recebimentoData || r.data;
      if (!ds) return false;
      const [y, m] = ds.split('-').map(Number);
      return y === year && m === month;
    });
  } catch { return []; }
}

// Fatura do cartão de crédito do mês — mesmo critério de Resumo.jsx/Graficos.jsx,
// pra que "Cartão de Crédito" entre no relatório igual aparece na tela de Gráficos.
function getFaturas(month, year) {
  try {
    const cartoes = JSON.parse(localStorage.getItem(CARTAO_KEY) || '[]');
    const lancs   = JSON.parse(localStorage.getItem(FATURA_KEY) || '[]');
    return cartoes.map(c => {
      const total = lancs.filter(l => l.cartaoId === c.id && l.mes === month && l.ano === year)
        .reduce((s, l) => s + (l.valor / (l.parcelas || 1)), 0);
      if (total <= 0) return null;
      const pago = c.faturasPagas?.[`${year}-${month}`] || false;
      const mm  = String(month).padStart(2, '0');
      const dia = String(c.diaPagamento || 10).padStart(2, '0');
      return {
        type: 'expense', description: `Fatura ${c.nome}`, category: 'Cartão de Crédito',
        amount: total, date: `${year}-${mm}-${dia}`, pago,
      };
    }).filter(Boolean);
  } catch { return []; }
}

function bycatRanking(list) {
  const bycat = {};
  list.forEach(t => { const c = t.category || 'Outros'; bycat[c] = (bycat[c] || 0) + parseFloat(t.amount || 0); });
  return Object.entries(bycat).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value }));
}

// Relatório em PDF da tela de Gráficos: descrição gasto-a-gasto + ranking por
// categoria, respeitando o mesmo filtro Pagos/Previsto mês e o período
// selecionado na tela.
export function exportGraficosPDF(month, year, viewMode) {
  const mesAno = `${MONTHS[month - 1]} ${year}`;
  const hoje   = new Date().toLocaleDateString('pt-BR');

  const despesasNorm = getDespesas(month, year).map(d => {
    const st = statusMes(d, month, year);
    const campos = getCamposMes(d, month, year);
    return {
      type: 'expense', description: campos.nome, category: campos.categoria || 'Outros',
      amount: st.pago && st.valorPago != null ? st.valorPago : parcelaValorMes(d, month, year),
      date: d.pagamentoData && st.pago ? d.pagamentoData : d.vencimento, pago: st.pago,
    };
  });
  const receitasNorm = getReceitas(month, year).map(r => {
    const st = statusMesReceita(r, month, year);
    const campos = getCamposMesReceita(r, month, year);
    return {
      type: 'income', description: campos.nome, category: campos.categoria || 'Outros',
      amount: st.recebida && st.valorRecebido != null ? parseFloat(st.valorRecebido) : parcelaValorMesReceita(r, month, year),
      date: r.recebimentoData || r.data, pago: st.recebida,
    };
  });
  const faturasNorm = getFaturas(month, year);

  const allTx = [...despesasNorm, ...faturasNorm, ...receitasNorm];
  const filtered = viewMode === 'pagos' ? allTx.filter(t => t.pago) : allTx;

  // Do mais antigo pro mais novo — leitura cronológica do mês, como um extrato.
  const despesasList = filtered.filter(t => t.type === 'expense').sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const receitasList = filtered.filter(t => t.type === 'income').sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const despesaRanking = bycatRanking(despesasList);
  const receitaRanking = bycatRanking(receitasList);
  const totalDespesas  = despesaRanking.reduce((s, d) => s + d.value, 0);
  const totalReceitas  = receitaRanking.reduce((s, d) => s + d.value, 0);

  const modoLabel = viewMode === 'pagos' ? 'Pagos' : 'Previsto mês';

  const rankingRows = (ranking, total) => ranking.map((c, i) => {
    const pct = total > 0 ? Math.round(c.value / total * 100) : 0;
    const color = CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length];
    return `
    <div class="rank-row">
      <div class="rank-num">${i + 1}º</div>
      <div class="rank-label">${esc(c.name)}</div>
      <div class="rank-bar-track">
        <div class="rank-bar" style="width:${Math.max(pct, 3)}%; background:${color}"></div>
      </div>
      <div class="rank-value">${esc(fmt(c.value))} · ${pct}%</div>
    </div>`;
  }).join('');

  const txRows = (list, statusLabels) => list.map(t => `
    <tr>
      <td>${esc(t.description)}</td>
      <td>${esc(t.category)}</td>
      <td style="text-align:right">${esc(fmt(t.amount))}</td>
      <td>${esc(fmtDate(t.date))}</td>
      <td><span class="${t.pago ? 'badge-green' : 'badge-yellow'}">${t.pago ? statusLabels[0] : statusLabels[1]}</span></td>
    </tr>`).join('');

  // Linha-resumo ao final de cada tabela: quantidade + total de cada status,
  // pra saber de bate-pronto quanto já saiu/entrou de fato e quanto falta.
  const txSummaryBar = (list, doneLabel, pendingLabel) => {
    const done = list.filter(t => t.pago);
    const pending = list.filter(t => !t.pago);
    const doneTotal = done.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const pendingTotal = pending.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    return `
    <div class="tx-summary">
      <div class="tx-summary-item"><span class="dot green"></span>${doneLabel}: <strong>${done.length}</strong> · Total <span class="amt green">${esc(fmt(doneTotal))}</span></div>
      <div class="tx-summary-item"><span class="dot yellow"></span>${pendingLabel}: <strong>${pending.length}</strong> · Total <span class="amt yellow">${esc(fmt(pendingTotal))}</span></div>
    </div>`;
  };

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Planeje — Gráficos — ${mesAno}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #f4f6f9; }
  body { font-family: 'Poppins', 'Segoe UI', Arial, sans-serif; color: #1e293b; font-size: 12px; }

  /* ── Capa / cabeçalho de marca ── */
  .hero {
    background: linear-gradient(135deg, #0f172a 0%, #12331f 55%, #15803d 130%);
    padding: 30px 36px 26px;
    position: relative;
    overflow: hidden;
  }
  .hero::after {
    content: ''; position: absolute; right: -60px; top: -80px; width: 260px; height: 260px;
    border-radius: 50%; background: radial-gradient(circle, rgba(34,197,94,0.35) 0%, transparent 70%);
  }
  .hero-top { display: flex; align-items: center; justify-content: space-between; position: relative; z-index: 1; }
  .hero-logo { height: 96px; }
  .hero-badge { display: inline-block; padding: 5px 14px; border-radius: 20px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; background: rgba(255,255,255,0.14); color: #ffffff; border: 1px solid rgba(255,255,255,0.25); }
  .hero-title { margin-top: 20px; position: relative; z-index: 1; }
  .hero-title h1 { font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.3px; }
  .hero-title p { font-size: 11.5px; color: rgba(255,255,255,0.65); margin-top: 4px; }

  .content { padding: 26px 36px 20px; }

  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 26px; }
  .card { border-radius: 16px; padding: 16px 18px; position: relative; overflow: hidden; }
  .card.expense { background: linear-gradient(145deg, #fff5f5 0%, #ffffff 100%); border: 1px solid #fecdd3; }
  .card.income  { background: linear-gradient(145deg, #f0fdf4 0%, #ffffff 100%); border: 1px solid #bbf7d0; }
  .card-top { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot.red { background: #f43f5e; } .dot.green { background: #22c55e; } .dot.yellow { background: #f59e0b; }
  .card .label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #64748b; }
  .card .value { font-size: 24px; font-weight: 800; margin-top: 2px; }
  .card .sub { font-size: 10.5px; color: #94a3b8; margin-top: 3px; }
  .green { color: #16a34a; } .red { color: #e11d48; } .yellow { color: #b45309; }

  .section { margin-bottom: 26px; }
  .section-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
  .section-head .bar { width: 4px; height: 16px; border-radius: 4px; }
  .section-head .bar.red { background: #f43f5e; } .section-head .bar.green { background: #22c55e; }
  .section-head h2 { font-size: 14px; font-weight: 700; color: #0f172a; }

  .rank-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; }
  .rank-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
  .rank-num { width: 16px; font-size: 9px; font-weight: 800; color: #94a3b8; flex-shrink: 0; }
  .rank-label { width: 108px; font-size: 10.5px; font-weight: 600; color: #334155; flex-shrink: 0; }
  .rank-bar-track { flex: 1; height: 15px; background: #f1f5f9; border-radius: 6px; overflow: hidden; }
  .rank-bar { height: 100%; border-radius: 6px; }
  .rank-value { width: 148px; font-size: 10.5px; font-weight: 700; color: #334155; text-align: right; flex-shrink: 0; }

  .tx-card { border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; }
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { width: 100%; min-width: 480px; border-collapse: collapse; font-size: 11px; }
  thead tr.th-expense th { background: linear-gradient(135deg, #e11d48, #be123c); }
  thead tr.th-income  th { background: linear-gradient(135deg, #16a34a, #15803d); }
  th { padding: 9px 12px; text-align: left; font-weight: 700; color: #ffffff; letter-spacing: 0.2px; }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; color: #334155; background: #ffffff; }
  .badge-green { background: #dcfce7; color: #15803d; padding: 3px 10px; border-radius: 20px; font-size: 9.5px; font-weight: 700; }
  .badge-yellow { background: #fef3c7; color: #b45309; padding: 3px 10px; border-radius: 20px; font-size: 9.5px; font-weight: 700; }
  .empty { color: #94a3b8; padding: 14px 0; font-size: 11px; }

  .tx-summary { display: flex; flex-wrap: wrap; gap: 8px 22px; padding: 11px 16px; background: #f8fafc; border-top: 1px solid #e2e8f0; }
  .tx-summary-item { font-size: 10.5px; font-weight: 600; color: #64748b; display: flex; align-items: center; gap: 6px; }
  .tx-summary-item strong { color: #334155; font-weight: 800; }
  .tx-summary-item .amt { font-weight: 800; }
  .tx-summary-item .amt.green { color: #16a34a; } .tx-summary-item .amt.yellow { color: #b45309; }

  .footer { display: flex; align-items: center; justify-content: space-between; padding: 16px 36px; border-top: 1px solid #e2e8f0; background: #ffffff; }
  .footer-brand { display: flex; align-items: center; gap: 8px; }
  .footer-brand img { height: 16px; }
  .footer-brand span { font-size: 10.5px; font-weight: 700; color: #16a34a; }
  .footer-meta { font-size: 9.5px; color: #94a3b8; }

  /* ── Mobile: telas estreitas abrindo o relatório antes de imprimir/salvar ── */
  @media (max-width: 560px) {
    .hero { padding: 22px 18px 20px; }
    .hero-logo { height: 52px; }
    .hero-badge { font-size: 9px; padding: 4px 10px; }
    .hero-title h1 { font-size: 19px; }
    .hero-title p { font-size: 10.5px; }
    .content { padding: 18px 14px 14px; }
    .cards { grid-template-columns: 1fr; gap: 10px; }
    .card .value { font-size: 20px; }
    .rank-card { padding: 12px 14px; }
    .rank-row { flex-wrap: wrap; row-gap: 4px; }
    .rank-label { width: auto; flex: 1 1 auto; }
    .rank-bar-track { flex-basis: 100%; order: 3; }
    .rank-value { width: auto; text-align: right; }
    .footer { flex-direction: column; gap: 8px; padding: 14px 18px; text-align: center; }
  }

  @media print {
    body { background: #fff; }
    .hero { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .section, .rank-card, table { break-inside: avoid; }
    tr { break-inside: avoid; }
  }
</style>
</head>
<body>

<div class="hero">
  <div class="hero-top">
    <div class="hero-logo">${LOGO_HORIZONTAL_WHITE_SVG}</div>
    <span class="hero-badge">${modoLabel}</span>
  </div>
  <div class="hero-title">
    <h1>Relatório de Gráficos</h1>
    <p>Período: ${mesAno} · Gerado em ${hoje}</p>
  </div>
</div>

<div class="content">

  <div class="cards">
    <div class="card expense">
      <div class="card-top"><span class="dot red"></span><span class="label">Total Despesas</span></div>
      <div class="value red">${fmt(totalDespesas)}</div>
      <div class="sub">${despesaRanking.length} categorias · ${despesasList.length} lançamentos</div>
    </div>
    <div class="card income">
      <div class="card-top"><span class="dot green"></span><span class="label">Total Receitas</span></div>
      <div class="value green">${fmt(totalReceitas)}</div>
      <div class="sub">${receitaRanking.length} categorias · ${receitasList.length} lançamentos</div>
    </div>
  </div>

  <div class="section">
    <div class="section-head"><span class="bar red"></span><h2>Ranking de Despesas por Categoria</h2></div>
    ${despesaRanking.length > 0 ? `<div class="rank-card">${rankingRows(despesaRanking, totalDespesas)}</div>` : '<p class="empty">Nenhuma despesa neste filtro.</p>'}
  </div>

  <div class="section">
    <div class="section-head"><span class="bar green"></span><h2>Ranking de Receitas por Categoria</h2></div>
    ${receitaRanking.length > 0 ? `<div class="rank-card">${rankingRows(receitaRanking, totalReceitas)}</div>` : '<p class="empty">Nenhuma receita neste filtro.</p>'}
  </div>

  <div class="section">
    <div class="section-head"><span class="bar red"></span><h2>Despesas — detalhado (${despesasList.length})</h2></div>
    ${despesasList.length > 0 ? `
    <div class="tx-card">
      <div class="table-scroll"><table>
        <thead><tr class="th-expense"><th>Descrição</th><th>Categoria</th><th style="text-align:right">Valor</th><th>Data</th><th>Status</th></tr></thead>
        <tbody>${txRows(despesasList, ['Pago', 'Pendente'])}</tbody>
      </table></div>
      ${txSummaryBar(despesasList, 'Pagas', 'Pendentes')}
    </div>` : '<p class="empty">Nenhuma despesa neste filtro.</p>'}
  </div>

  <div class="section">
    <div class="section-head"><span class="bar green"></span><h2>Receitas — detalhado (${receitasList.length})</h2></div>
    ${receitasList.length > 0 ? `
    <div class="tx-card">
      <div class="table-scroll"><table>
        <thead><tr class="th-income"><th>Descrição</th><th>Categoria</th><th style="text-align:right">Valor</th><th>Data</th><th>Status</th></tr></thead>
        <tbody>${txRows(receitasList, ['Recebido', 'A receber'])}</tbody>
      </table></div>
      ${txSummaryBar(receitasList, 'Recebidas', 'A receber')}
    </div>` : '<p class="empty">Nenhuma receita neste filtro.</p>'}
  </div>

</div>

<div class="footer">
  <div class="footer-brand">${LOGO_ICON_GREEN_SVG}<span>planeje</span></div>
  <div class="footer-meta">planejeapp.com.br · Gerado em ${hoje}</div>
</div>

<script>window.onload = () => { setTimeout(() => window.print(), 150); }<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href  = url; a.download = `planeje-graficos-${MONTHS[month-1].toLowerCase()}-${year}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function exportCSV(month, year) {
  const despesas = getDespesas(month, year);
  const receitas = getReceitas(month, year);
  const mesAno   = `${MONTHS[month - 1]} ${year}`;

  const rows = [
    ['PLANEJE — Relatório Financeiro'],
    [`Período: ${mesAno}`],
    [`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`],
    [],
    ['DESPESAS'],
    ['Nome','Categoria','Valor','Vencimento','Status','Recorrência','Parcelas'],
    ...despesas.map(d => [
      getCamposMes(d, month, year).nome,
      getCamposMes(d, month, year).categoria || 'Outros',
      (statusMes(d, month, year).pago ? (statusMes(d, month, year).valorPago ?? parcelaValorMes(d, month, year)) : parcelaValorMes(d, month, year)).toFixed(2).replace('.', ','),
      fmtDate(d.vencimento),
      statusMes(d, month, year).pago ? 'Pago' : 'Pendente',
      d.recorrencia === 'fixa' ? 'Fixa' : d.recorrencia === 'parcelar' ? 'Parcelado' : 'Única',
      d.recorrencia === 'parcelar' ? `${d.totalParcelas}x` : '',
    ]),
    [],
    [`Total despesas: ${fmt(despesas.reduce((s, d) => s + parcelaValorMes(d, month, year), 0))}`],
    [`Total pago: ${fmt(despesas.filter(d => statusMes(d, month, year).pago).reduce((s, d) => s + parseFloat(statusMes(d, month, year).valorPago ?? parcelaValorMes(d, month, year)), 0))}`],
    [`Total pendente: ${fmt(despesas.filter(d => !statusMes(d, month, year).pago).reduce((s, d) => s + parcelaValorMes(d, month, year), 0))}`],
    [],
    ['RECEITAS'],
    ['Nome','Categoria','Valor','Data','Status','Recorrência'],
    ...receitas.map(r => [
      getCamposMesReceita(r, month, year).nome,
      getCamposMesReceita(r, month, year).categoria || 'Outros',
      (parseFloat(statusMesReceita(r, month, year).valorRecebido || parcelaValorMesReceita(r, month, year) || 0)).toFixed(2).replace('.', ','),
      fmtDate(r.recebimentoData || r.data),
      statusMesReceita(r, month, year).recebida ? 'Recebido' : 'A receber',
      r.recorrencia === 'fixa' ? 'Fixa' : r.recorrencia === 'parcelar' ? 'Parcelado' : 'Única',
    ]),
    [],
    [`Total receitas: ${fmt(receitas.reduce((s, r) => s + parcelaValorMesReceita(r, month, year), 0))}`],
    [`Total recebido: ${fmt(receitas.filter(r => statusMesReceita(r, month, year).recebida).reduce((s, r) => s + parseFloat(statusMesReceita(r, month, year).valorRecebido || parcelaValorMesReceita(r, month, year)), 0))}`],
    [],
    ['RESUMO'],
    [`Total despesas,${fmt(despesas.reduce((s, d) => s + parcelaValorMes(d, month, year), 0))}`],
    [`Total receitas,${fmt(receitas.reduce((s, r) => s + parcelaValorMesReceita(r, month, year), 0))}`],
    [`Saldo previsto,${fmt(receitas.reduce((s, r) => s + parcelaValorMesReceita(r, month, year), 0) - despesas.reduce((s, d) => s + parcelaValorMes(d, month, year), 0))}`],
  ];

  const csvContent = '﻿' + rows.map(row =>
    (Array.isArray(row) ? row : [row]).map(cell =>
      `"${String(cell ?? '').replace(/"/g, '""')}"`
    ).join(';')
  ).join('\r\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `planeje-${MONTHS[month - 1].toLowerCase()}-${year}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportPDF(month, year) {
  const despesas = getDespesas(month, year);
  const receitas = getReceitas(month, year);
  const mesAno   = `${MONTHS[month - 1]} ${year}`;
  const hoje     = new Date().toLocaleDateString('pt-BR');

  const totalDesp  = despesas.reduce((s, d) => s + parcelaValorMes(d, month, year), 0);
  const totalRec   = receitas.reduce((s, r) => s + parcelaValorMesReceita(r, month, year), 0);
  const pagoDesp   = despesas.filter(d => statusMes(d, month, year).pago).reduce((s, d) => s + parseFloat(statusMes(d, month, year).valorPago ?? parcelaValorMes(d, month, year)), 0);
  const pendDesp   = despesas.filter(d => !statusMes(d, month, year).pago).reduce((s, d) => s + parcelaValorMes(d, month, year), 0);
  const recebRec   = receitas.filter(r => statusMesReceita(r, month, year).recebida).reduce((s, r) => s + parseFloat(statusMesReceita(r, month, year).valorRecebido || parcelaValorMesReceita(r, month, year)), 0);
  const saldo      = totalRec - totalDesp;

  const rowsDesp = despesas.map(d => {
    const st = statusMes(d, month, year);
    const campos = getCamposMes(d, month, year);
    const valorLinha = st.pago && st.valorPago != null ? st.valorPago : parcelaValorMes(d, month, year);
    return `
    <tr>
      <td>${esc(campos.nome)}</td>
      <td>${esc(campos.categoria || 'Outros')}</td>
      <td style="text-align:right">${esc(fmt(valorLinha))}</td>
      <td>${esc(fmtDate(d.vencimento))}</td>
      <td><span class="${st.pago ? 'badge-green' : 'badge-red'}">${st.pago ? 'Pago' : 'Pendente'}</span></td>
    </tr>`;
  }).join('');

  const rowsRec = receitas.map(r => {
    const recebida = statusMesReceita(r, month, year).recebida;
    const campos = getCamposMesReceita(r, month, year);
    return `
    <tr>
      <td>${esc(campos.nome)}</td>
      <td>${esc(campos.categoria || 'Outros')}</td>
      <td style="text-align:right">${esc(fmt(parcelaValorMesReceita(r, month, year)))}</td>
      <td>${esc(fmtDate(r.recebimentoData || r.data))}</td>
      <td><span class="${recebida ? 'badge-green' : 'badge-yellow'}">${recebida ? 'Recebido' : 'A receber'}</span></td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<title>Planeje — ${mesAno}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #1a1a2e; font-size: 12px; padding: 32px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #22c55e; }
  .header-title { flex: 1; }
  .header-title h1 { font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
  .header-title p { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .logo { font-size: 28px; font-weight: 900; color: #22c55e; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .card { border-radius: 12px; padding: 14px 16px; border: 1px solid #e5e7eb; background: #f9fafb; }
  .card .label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 4px; }
  .card .value { font-size: 18px; font-weight: 800; }
  .card .sub { font-size: 10px; color: #9ca3af; margin-top: 2px; }
  .green { color: #16a34a; } .red { color: #dc2626; } .yellow { color: #d97706; } .blue { color: #2563eb; }
  h2 { font-size: 14px; font-weight: 700; color: #0f172a; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f3f4f6; padding: 8px 10px; text-align: left; font-weight: 700; color: #374151; border-bottom: 1px solid #d1d5db; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; color: #374151; }
  tr:hover td { background: #f9fafb; }
  .badge-green { background: #dcfce7; color: #16a34a; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; }
  .badge-red { background: #fee2e2; color: #dc2626; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; }
  .badge-yellow { background: #fef3c7; color: #d97706; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; }
  .totals { display: flex; gap: 12px; margin-top: 8px; padding: 12px 16px; background: #f9fafb; border-radius: 10px; font-size: 11px; }
  .totals span { font-weight: 700; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
<div class="header">
  <div class="logo">P</div>
  <div class="header-title">
    <h1>Relatório Financeiro</h1>
    <p>Período: ${mesAno} · Gerado em: ${hoje}</p>
  </div>
</div>

<div class="cards">
  <div class="card"><div class="label">Receitas</div><div class="value green">${fmt(totalRec)}</div><div class="sub">Recebido: ${fmt(recebRec)}</div></div>
  <div class="card"><div class="label">Despesas</div><div class="value red">${fmt(totalDesp)}</div><div class="sub">Pago: ${fmt(pagoDesp)}</div></div>
  <div class="card"><div class="label">A Pagar</div><div class="value yellow">${fmt(pendDesp)}</div><div class="sub">${despesas.filter(d=>!statusMes(d, month, year).pago).length} pendentes</div></div>
  <div class="card"><div class="label">Saldo Previsto</div><div class="value ${saldo >= 0 ? 'green' : 'red'}">${fmt(saldo)}</div><div class="sub">Receitas - Despesas</div></div>
</div>

<h2>Despesas (${despesas.length})</h2>
${despesas.length > 0 ? `
<table>
  <thead><tr><th>Nome</th><th>Categoria</th><th style="text-align:right">Valor</th><th>Vencimento</th><th>Status</th></tr></thead>
  <tbody>${rowsDesp}</tbody>
</table>
<div class="totals">
  <div>Total: <span class="red">${fmt(totalDesp)}</span></div>
  <div>Pago: <span class="green">${fmt(pagoDesp)}</span></div>
  <div>Pendente: <span class="yellow">${fmt(pendDesp)}</span></div>
</div>` : '<p style="color:#9ca3af;padding:12px 0">Nenhuma despesa registrada.</p>'}

<h2>Receitas (${receitas.length})</h2>
${receitas.length > 0 ? `
<table>
  <thead><tr><th>Nome</th><th>Categoria</th><th style="text-align:right">Valor</th><th>Data</th><th>Status</th></tr></thead>
  <tbody>${rowsRec}</tbody>
</table>
<div class="totals">
  <div>Total: <span class="green">${fmt(totalRec)}</span></div>
  <div>Recebido: <span class="green">${fmt(recebRec)}</span></div>
  <div>A receber: <span class="yellow">${fmt(totalRec - recebRec)}</span></div>
</div>` : '<p style="color:#9ca3af;padding:12px 0">Nenhuma receita registrada.</p>'}

<div class="footer">Gerado pelo Planeje · ${hoje}</div>

<script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const w    = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href  = url; a.download = `planeje-${MONTHS[month-1].toLowerCase()}-${year}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
