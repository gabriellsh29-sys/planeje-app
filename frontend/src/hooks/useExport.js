const DIVIDA_KEY  = 'financeiro_dividas';
const RECEITA_KEY = 'financeiro_receitas';
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function fmt(v) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0); }
function fmtDate(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return d || ''; } }

function parcelaValor(d) {
  if (d.recorrencia === 'parcelar' && d.totalParcelas > 1) return d.valor / d.totalParcelas;
  return d.valor;
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

function getReceitas(month, year) {
  try {
    const all = JSON.parse(localStorage.getItem(RECEITA_KEY) || '[]');
    return all.filter(r => {
      if (r.recorrencia === 'fixa') {
        if (!r.dataBase) return true;
        const [ry, rm] = r.dataBase.split('-').map(Number);
        return (year * 12 + month - 1) >= (ry * 12 + rm - 1);
      }
      const ds = r.dataRecebimento || r.dataBase;
      if (!ds) return false;
      const [y, m] = ds.split('-').map(Number);
      return y === year && m === month;
    });
  } catch { return []; }
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
      d.nome,
      d.categoria || 'Outros',
      parcelaValor(d).toFixed(2).replace('.', ','),
      fmtDate(d.vencimento),
      d.pago ? 'Pago' : 'Pendente',
      d.recorrencia === 'fixa' ? 'Fixa' : d.recorrencia === 'parcelar' ? 'Parcelado' : 'Única',
      d.recorrencia === 'parcelar' ? `${d.totalParcelas}x` : '',
    ]),
    [],
    [`Total despesas: ${fmt(despesas.reduce((s, d) => s + parcelaValor(d), 0))}`],
    [`Total pago: ${fmt(despesas.filter(d => d.pago).reduce((s, d) => s + parseFloat(d.valorPago ?? parcelaValor(d)), 0))}`],
    [`Total pendente: ${fmt(despesas.filter(d => !d.pago).reduce((s, d) => s + parcelaValor(d), 0))}`],
    [],
    ['RECEITAS'],
    ['Nome','Categoria','Valor','Data','Status','Recorrência'],
    ...receitas.map(r => [
      r.nome,
      r.categoria || 'Outros',
      (parseFloat(r.valorConfirmado || r.valor || 0)).toFixed(2).replace('.', ','),
      fmtDate(r.dataRecebimento || r.dataBase),
      r.recebido ? 'Recebido' : 'A receber',
      r.recorrencia === 'fixa' ? 'Fixa' : 'Única',
    ]),
    [],
    [`Total receitas: ${fmt(receitas.reduce((s, r) => s + parseFloat(r.valorConfirmado || r.valor || 0), 0))}`],
    [`Total recebido: ${fmt(receitas.filter(r => r.recebido).reduce((s, r) => s + parseFloat(r.valorConfirmado || r.valor || 0), 0))}`],
    [],
    ['RESUMO'],
    [`Total despesas,${fmt(despesas.reduce((s, d) => s + parcelaValor(d), 0))}`],
    [`Total receitas,${fmt(receitas.reduce((s, r) => s + parseFloat(r.valorConfirmado || r.valor || 0), 0))}`],
    [`Saldo previsto,${fmt(receitas.reduce((s, r) => s + parseFloat(r.valorConfirmado || r.valor || 0), 0) - despesas.reduce((s, d) => s + parcelaValor(d), 0))}`],
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

  const totalDesp  = despesas.reduce((s, d) => s + parcelaValor(d), 0);
  const totalRec   = receitas.reduce((s, r) => s + parseFloat(r.valorConfirmado || r.valor || 0), 0);
  const pagoDesp   = despesas.filter(d => d.pago).reduce((s, d) => s + parseFloat(d.valorPago ?? parcelaValor(d)), 0);
  const pendDesp   = despesas.filter(d => !d.pago).reduce((s, d) => s + parcelaValor(d), 0);
  const recebRec   = receitas.filter(r => r.recebido).reduce((s, r) => s + parseFloat(r.valorConfirmado || r.valor || 0), 0);
  const saldo      = totalRec - totalDesp;

  const rowsDesp = despesas.map(d => `
    <tr>
      <td>${d.nome || ''}</td>
      <td>${d.categoria || 'Outros'}</td>
      <td style="text-align:right">${fmt(parcelaValor(d))}</td>
      <td>${fmtDate(d.vencimento)}</td>
      <td><span class="${d.pago ? 'badge-green' : 'badge-red'}">${d.pago ? 'Pago' : 'Pendente'}</span></td>
    </tr>`).join('');

  const rowsRec = receitas.map(r => `
    <tr>
      <td>${r.nome || ''}</td>
      <td>${r.categoria || 'Outros'}</td>
      <td style="text-align:right">${fmt(parseFloat(r.valorConfirmado || r.valor || 0))}</td>
      <td>${fmtDate(r.dataRecebimento || r.dataBase)}</td>
      <td><span class="${r.recebido ? 'badge-green' : 'badge-yellow'}">${r.recebido ? 'Recebido' : 'A receber'}</span></td>
    </tr>`).join('');

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
  <div class="card"><div class="label">A Pagar</div><div class="value yellow">${fmt(pendDesp)}</div><div class="sub">${despesas.filter(d=>!d.pago).length} pendentes</div></div>
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
