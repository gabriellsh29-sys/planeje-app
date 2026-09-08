const DIVIDA_KEY  = 'financeiro_dividas';
const RECEITA_KEY = 'financeiro_receitas';
const CARTAO_KEY  = 'planeje_cartoes';
const FATURA_KEY  = 'planeje_faturas';
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// Mesma paleta categórica usada nos rankings da tela de Gráficos (Graficos.jsx)
// — mantém a identidade visual do app também no PDF exportado.
const CATEGORICAL_COLORS = ['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];

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

  const despesasList = filtered.filter(t => t.type === 'expense').sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const receitasList = filtered.filter(t => t.type === 'income').sort((a, b) => (b.date || '').localeCompare(a.date || ''));

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

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<title>Planeje — Gráficos — ${mesAno}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #1a1a2e; font-size: 12px; padding: 32px; }
  .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #22c55e; }
  .header-title { flex: 1; }
  .header-title h1 { font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
  .header-title p { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .logo { font-size: 28px; font-weight: 900; color: #22c55e; }
  .badge-mode { display: inline-block; margin-top: 6px; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; background: rgba(34,197,94,0.12); color: #16a34a; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; }
  .card { border-radius: 12px; padding: 14px 16px; border: 1px solid #e5e7eb; }
  .card.expense { background: #fef2f2; border-color: #fecaca; }
  .card.income  { background: #f0fdf4; border-color: #bbf7d0; }
  .card .label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-bottom: 4px; }
  .card .value { font-size: 20px; font-weight: 800; }
  .card .sub { font-size: 10px; color: #9ca3af; margin-top: 2px; }
  .green { color: #16a34a; } .red { color: #dc2626; }
  h2 { font-size: 14px; font-weight: 700; color: #0f172a; margin: 22px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
  .rank-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .rank-label { width: 110px; font-size: 10px; font-weight: 600; color: #374151; flex-shrink: 0; }
  .rank-bar-track { flex: 1; height: 16px; background: #f3f4f6; border-radius: 6px; overflow: hidden; }
  .rank-bar { height: 100%; border-radius: 6px; }
  .rank-value { width: 140px; font-size: 10px; font-weight: 700; color: #374151; text-align: right; flex-shrink: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
  th { background: #f3f4f6; padding: 8px 10px; text-align: left; font-weight: 700; color: #374151; border-bottom: 1px solid #d1d5db; }
  td { padding: 7px 10px; border-bottom: 1px solid #f3f4f6; color: #374151; }
  .badge-green { background: #dcfce7; color: #16a34a; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; }
  .badge-yellow { background: #fef3c7; color: #d97706; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 600; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af; text-align: center; }
  @media print { body { padding: 16px; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<div class="header">
  <div class="logo">P</div>
  <div class="header-title">
    <h1>Relatório de Gráficos</h1>
    <p>Período: ${mesAno} · Gerado em: ${hoje}</p>
    <span class="badge-mode">${modoLabel}</span>
  </div>
</div>

<div class="cards">
  <div class="card expense"><div class="label">Total Despesas</div><div class="value red">${fmt(totalDespesas)}</div><div class="sub">${despesaRanking.length} categorias</div></div>
  <div class="card income"><div class="label">Total Receitas</div><div class="value green">${fmt(totalReceitas)}</div><div class="sub">${receitaRanking.length} categorias</div></div>
</div>

<h2>Ranking de Despesas por Categoria</h2>
${despesaRanking.length > 0 ? rankingRows(despesaRanking, totalDespesas) : '<p style="color:#9ca3af;padding:8px 0">Nenhuma despesa neste filtro.</p>'}

<h2>Ranking de Receitas por Categoria</h2>
${receitaRanking.length > 0 ? rankingRows(receitaRanking, totalReceitas) : '<p style="color:#9ca3af;padding:8px 0">Nenhuma receita neste filtro.</p>'}

<h2>Despesas — detalhado (${despesasList.length})</h2>
${despesasList.length > 0 ? `
<table>
  <thead><tr><th>Descrição</th><th>Categoria</th><th style="text-align:right">Valor</th><th>Data</th><th>Status</th></tr></thead>
  <tbody>${txRows(despesasList, ['Pago', 'Pendente'])}</tbody>
</table>` : '<p style="color:#9ca3af;padding:8px 0">Nenhuma despesa neste filtro.</p>'}

<h2>Receitas — detalhado (${receitasList.length})</h2>
${receitasList.length > 0 ? `
<table>
  <thead><tr><th>Descrição</th><th>Categoria</th><th style="text-align:right">Valor</th><th>Data</th><th>Status</th></tr></thead>
  <tbody>${txRows(receitasList, ['Recebido', 'A receber'])}</tbody>
</table>` : '<p style="color:#9ca3af;padding:8px 0">Nenhuma receita neste filtro.</p>'}

<div class="footer">Gerado pelo Planeje · ${hoje}</div>

<script>window.onload = () => { window.print(); }<\/script>
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
