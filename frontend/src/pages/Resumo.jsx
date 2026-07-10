import React, { useMemo, useState, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell } from 'recharts';
import { exportCSV, exportPDF } from '../hooks/useExport';

const fmt = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
const fmtShort = (v) => { if (v >= 1000) return `${(v / 1000).toFixed(0)}k`; return v.toFixed(0); };
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return d; } };

const SALDO_KEY   = 'financeiro_saldo_inicial';
const DIVIDA_KEY  = 'financeiro_dividas';
const RECEITA_KEY = 'financeiro_receitas';
const CARTAO_KEY  = 'planeje_cartoes';
const FATURA_KEY  = 'planeje_faturas';
const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#f43f5e', '#a855f7', '#06b6d4', '#ef4444', '#c9a84c'];

function getSaldoInicial() { try { return parseFloat(localStorage.getItem(SALDO_KEY) || '0') || 0; } catch { return 0; } }
function setSaldoInicial(v) { localStorage.setItem(SALDO_KEY, v.toString()); }

function parcelaValor(d) {
  if (d.recorrencia === 'parcelar' && d.totalParcelas > 1) return d.valor / d.totalParcelas;
  return d.valor;
}
function parcelaAbrangeMs(d, month, year) {
  if (!d.vencimento) return false;
  const [vy, vm] = d.vencimento.split('-').map(Number);
  const inicio = vy * 12 + (vm - 1);
  const fim = inicio + ((d.totalParcelas || 1) - 1);
  return (year * 12 + (month - 1)) >= inicio && (year * 12 + (month - 1)) <= fim;
}

// Itens "fixa" guardam o pagamento por mês em d.pagamentos['YYYY-MM'],
// para que quitar um mês não afete os demais.
function statusMes(d, month, year) {
  if (d.recorrencia === 'fixa') {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const p = d.pagamentos && d.pagamentos[key];
    if (p) return { pago: !!p.pago, pagamentoData: p.pagamentoData || null, valorPago: p.valorPago ?? null };
    return { pago: false, pagamentoData: null, valorPago: null };
  }
  return { pago: !!d.pago, pagamentoData: d.pagamentoData || null, valorPago: d.valorPago ?? null };
}

function loadDespesas(month, year) {
  try {
    const all = JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]');
    return all.filter(d => {
      if (d.recorrencia === 'fixa') {
        if (!d.vencimento) return true;
        const [vy, vm] = d.vencimento.split('-').map(Number);
        return (year * 12 + (month - 1)) >= (vy * 12 + (vm - 1));
      }
      if (d.recorrencia === 'parcelar') return parcelaAbrangeMs(d, month, year);
      const dateStr = d.pagamentoData || d.vencimento;
      if (!dateStr) return false;
      const [y, m] = dateStr.split('-').map(Number);
      return y === year && m === month;
    }).map(d => {
      const mm = String(month).padStart(2, '0');
      let date;
      if ((d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') && d.vencimento) {
        const day = d.vencimento.split('-')[2];
        date = `${year}-${mm}-${day}`;
      } else {
        date = d.pagamentoData || d.vencimento || `${year}-${mm}-01`;
      }
      const st = statusMes(d, month, year);
      return { id: 'div_' + d.id, type: 'expense', description: d.nome, category: d.categoria || 'Outros',
        amount: parcelaValor(d), valorPago: st.valorPago, date, pago: st.pago, pagamentoData: st.pagamentoData };
    });
  } catch { return []; }
}

// Contas "fixa" que tinham vencimento em meses anteriores mas foram pagas
// somente neste mês (pagamentoData). Não mexe em parcelar/não-recorrente
// nem em cartão/fatura — apenas soma esses pagamentos extras às transações
// e ao saldo do mês em que o pagamento foi efetivado de fato.
function loadPagamentosAtrasadosNoMes(month, year) {
  try {
    const all = JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]');
    const currentKey = `${year}-${String(month).padStart(2, '0')}`;
    const out = [];
    all.forEach(d => {
      if (d.recorrencia !== 'fixa' || !d.pagamentos) return;
      Object.entries(d.pagamentos).forEach(([key, p]) => {
        if (key === currentKey) return; // já contabilizado no fluxo normal do mês
        if (!p || !p.pago || !p.pagamentoData) return;
        const [py, pm] = p.pagamentoData.split('-').map(Number);
        if (py !== year || pm !== month) return;
        const valor = p.valorPago ?? d.valor;
        out.push({
          id: `pagatraso_${d.id}_${key}`, type: 'expense', description: d.nome, category: d.categoria || 'Outros',
          amount: valor, valorPago: valor, date: p.pagamentoData, pago: true, pagamentoData: p.pagamentoData,
        });
      });
    });
    return out;
  } catch { return []; }
}

function loadFaturas(month, year) {
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
      const date = `${year}-${mm}-${dia}`;
      return {
        id: 'fat_' + c.id, type: 'expense', description: `Fatura ${c.nome}`,
        category: 'Cartão de Crédito', amount: total, date,
        pago, pagamentoData: pago ? date : null, valorPago: pago ? total : null,
      };
    }).filter(Boolean);
  } catch { return []; }
}

function loadReceitas(month, year) {
  try {
    const all = JSON.parse(localStorage.getItem(RECEITA_KEY) || '[]');
    return all.filter(r => {
      if (r.recorrencia === 'fixa') {
        if (!r.data) return true;
        const [ry, rm] = r.data.split('-').map(Number);
        return (year * 12 + (month - 1)) >= (ry * 12 + (rm - 1));
      }
      const dateStr = r.recebimentoData || r.data;
      if (!dateStr) return false;
      const [y, m] = dateStr.split('-').map(Number);
      return y === year && m === month;
    }).map(r => {
      const mm = String(month).padStart(2, '0');
      const day = (r.data || '').split('-')[2] || '01';
      const date = r.recorrencia === 'fixa'
        ? `${year}-${mm}-${day}`
        : (r.recebimentoData || r.data || `${year}-${mm}-01`);
      return { id: 'rec_' + r.id, type: 'income', description: r.nome, category: r.categoria || 'Outros',
        amount: parseFloat(r.valorRecebido || r.valor || 0), date, pago: r.recebida, pagamentoData: r.recebimentoData };
    });
  } catch { return []; }
}

export default function Resumo({ loading, month, year }) {
  const [saldoInicial, setSaldo] = useState(getSaldoInicial);
  const [editSaldo,    setEditSaldo]  = useState(false);
  const [saldoInput,   setSaldoInput] = useState('');
  const [showExport,   setShowExport] = useState(false);
  const [syncVer,      setSyncVer]    = useState(0);

  useEffect(() => {
    const reload = () => { setSaldo(getSaldoInicial()); setSyncVer(v => v + 1); };
    window.addEventListener('planeje-sync', reload);
    return () => window.removeEventListener('planeje-sync', reload);
  }, []);

  const despesas = useMemo(() => [...loadDespesas(month, year), ...loadFaturas(month, year)], [month, year, syncVer]);
  const receitas = useMemo(() => loadReceitas(month, year), [month, year, syncVer]);
  // Contas fixas vencidas em meses anteriores, mas pagas neste mês.
  const pagamentosAtrasados = useMemo(() => loadPagamentosAtrasadosNoMes(month, year), [month, year, syncVer]);

  const totalExpense   = despesas.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const totalIncome    = receitas.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const pagoExpense    = despesas.filter(t => t.pago && t.pagamentoData).reduce((s, t) => s + parseFloat(t.valorPago ?? t.amount ?? 0), 0)
                       + pagamentosAtrasados.reduce((s, t) => s + parseFloat(t.valorPago ?? t.amount ?? 0), 0);
  const pagoIncome     = receitas.filter(t => t.pago && t.pagamentoData).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const pendingExpense = despesas.filter(t => !t.pago).reduce((s, t) => s + parseFloat(t.amount || 0), 0);
  const pendingCount   = despesas.filter(t => !t.pago).length;
  const saldoConta     = saldoInicial - pagoExpense + pagoIncome;

  const openEditSaldo = () => { setSaldoInput(saldoInicial > 0 ? saldoInicial.toFixed(2).replace('.', ',') : ''); setEditSaldo(true); };
  const saveSaldo = () => { const val = parseFloat(saldoInput.replace(',', '.')) || 0; setSaldo(val); setSaldoInicial(val); setEditSaldo(false); };

  const allTransacoes = [...despesas, ...pagamentosAtrasados, ...receitas];
  const recent = [...allTransacoes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  const chartData = useMemo(() => {
    const byDay = {};
    despesas.forEach(tx => {
      const d = tx.date.slice(0, 10);
      if (!byDay[d]) byDay[d] = { expense: 0 };
      byDay[d].expense += parseFloat(tx.amount || 0);
    });
    return Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date: fmtDate(date), ...v }));
  }, [month, year, despesas.length]);

  const categoryData = useMemo(() => {
    const bycat = {};
    despesas.forEach(tx => { const c = tx.category || 'Outros'; bycat[c] = (bycat[c] || 0) + parseFloat(tx.amount || 0); });
    return Object.entries(bycat).sort(([, a], [, b]) => b - a).slice(0, 5).map(([name, value]) => ({ name, value }));
  }, [despesas.length]);

  const totalCat = categoryData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="p-4 md:p-5 pb-24 md:pb-8 space-y-3 animate-fade-in">

      {/* ── EXPORTAR ── */}
      <div className="flex justify-end">
        <div className="relative">
          <button onClick={() => setShowExport(s => !s)}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all"
            style={{ background: 'rgba(201,168,76,0.1)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.2)' }}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
            Exportar
          </button>
          {showExport && (
            <div className="absolute right-0 top-full mt-1 w-44 rounded-xl overflow-hidden z-50 shadow-xl"
              style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)' }}>
              <button onClick={() => { exportCSV(month, year); setShowExport(false); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-xs font-medium text-white hover:bg-white/5 transition text-left">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-400">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd"/>
                </svg>
                Baixar CSV
              </button>
              <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />
              <button onClick={() => { exportPDF(month, year); setShowExport(false); }}
                className="w-full flex items-center gap-2 px-4 py-3 text-xs font-medium text-white hover:bg-white/5 transition text-left">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-red-400">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/>
                  <path d="M8 11a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1zm0 3a1 1 0 011-1h4a1 1 0 110 2H9a1 1 0 01-1-1z"/>
                </svg>
                Imprimir / PDF
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── SALDO EM CONTA ── */}
      <div className="relative rounded-2xl p-5 overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a2235 0%, #141920 100%)', border: '1px solid rgba(34,197,94,0.15)' }}>
        <div className="absolute top-0 right-0 w-56 h-40 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 100% 0%, rgba(34,197,94,0.1) 0%, transparent 65%)' }} />
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-widest uppercase mb-1 text-white">Saldo em Conta</p>
            <p className="font-bold leading-none tracking-tight mt-1"
              style={{ fontSize: 34, color: saldoConta >= 0 ? '#22c55e' : '#f43f5e' }}>
              {fmt(saldoConta)}
            </p>
            <p className="mt-2 text-xs text-white">
              {pagoExpense === 0 && pagoIncome === 0 ? 'Atualizado agora' : `Pago: ${fmt(pagoExpense)} · Recebido: ${fmt(pagoIncome)}`}
            </p>
          </div>
          <button onClick={openEditSaldo}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl transition hover:opacity-80"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', color: '#ffffff' }}>
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M12.854.146a.5.5 0 00-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 000-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 016 13.5V13h-.5a.5.5 0 01-.5-.5V12h-.5a.5.5 0 01-.5-.5V11h-.5a.5.5 0 01-.5-.5V10h-.5a.499.499 0 01-.175-.032l-.179.178a.5.5 0 00-.11.168l-2 5a.5.5 0 00.65.65l5-2a.5.5 0 00.168-.11l.178-.178z"/></svg>
            Ajustar
          </button>
        </div>
      </div>

      {/* ── 3 CARDS ── */}
      <div className="grid grid-cols-3 gap-2 md:gap-3">
        <SummaryCard label="RECEITAS" value={totalIncome} color="#22c55e" sub="Este mês" />
        <SummaryCard label="DESPESAS" value={totalExpense} color="#f43f5e" sub="Este mês" />
        <SummaryCard label="A PAGAR" value={pendingExpense} color="#f59e0b"
          sub={`${pendingCount} pendente${pendingCount !== 1 ? 's' : ''}`} />
      </div>

      {/* ── EVOLUÇÃO ── */}
      {chartData.length > 0 && (
        <div className="rounded-2xl p-4"
          style={{ background: 'linear-gradient(135deg, #1a2235 0%, #141920 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-white text-sm font-semibold mb-4">Evolução de Despesas</p>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="expG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#ffffff', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmtShort} tick={{ fill: '#ffffff', fontSize: 9 }} axisLine={false} tickLine={false} width={32} />
              <Tooltip
                contentStyle={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, fontSize: 11 }}
                labelStyle={{ color: '#fff', marginBottom: 4 }}
                formatter={(v) => [fmt(v), 'Despesas']}
              />
              <Area type="monotone" dataKey="expense" stroke="#22c55e" strokeWidth={2} fill="url(#expG)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── BOTTOM: DONUT + TRANSAÇÕES ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

        {categoryData.length > 0 && (
          <div className="rounded-2xl p-4"
            style={{ background: 'linear-gradient(135deg, #1a2235 0%, #141920 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-white text-sm font-semibold mb-3">Despesas por Categoria</p>
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0">
                <PieChart width={130} height={130}>
                  <Pie data={categoryData} cx={65} cy={65} innerRadius={36} outerRadius={58}
                    dataKey="value" paddingAngle={3} startAngle={90} endAngle={-270}>
                    {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                </PieChart>
              </div>
              <div className="flex-1 space-y-2">
                {categoryData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-white text-xs truncate">{d.name}</span>
                    </div>
                    <span className="text-white text-xs font-semibold flex-shrink-0">
                      {totalCat > 0 ? Math.round(d.value / totalCat * 100) : 0}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Últimas transações */}
        <div className="rounded-2xl p-4"
          style={{ background: 'linear-gradient(135deg, #1a2235 0%, #141920 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-white text-sm font-semibold mb-3">Últimas Transações</p>
          {loading ? (
            <div className="space-y-2.5">{[...Array(4)].map((_, i) => <div key={i} className="h-10 skeleton" />)}</div>
          ) : recent.length === 0 ? (
            <p className="text-center py-8 text-sm text-white">Nenhuma transação</p>
          ) : (
            <div className="space-y-1">
              {recent.map(tx => (
                <div key={tx.id} className="flex items-center gap-3 py-2 rounded-xl px-2 transition hover:bg-white/3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: tx.type === 'income' ? 'rgba(34,197,94,0.12)' : 'rgba(244,63,94,0.12)' }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"
                      style={{ color: tx.type === 'income' ? '#22c55e' : '#f43f5e',
                               transform: tx.type === 'income' ? 'rotate(-45deg)' : 'rotate(45deg)' }}>
                      <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold truncate">{tx.description}</p>
                    <p className="text-[10px] mt-0.5 text-white">{fmtDate(tx.date)}</p>
                  </div>
                  <span className="text-xs font-bold flex-shrink-0"
                    style={{ color: tx.type === 'income' ? '#22c55e' : '#f43f5e' }}>
                    {tx.type === 'income' ? '+' : '-'}{fmt(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal ajustar saldo */}
      {editSaldo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(10px)' }} />
          <div className="relative card-premium p-6 w-full max-w-xs animate-scale-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-semibold mb-1">Saldo em conta</h3>
            <p className="text-xs mb-4 text-white">Informe o saldo atual da sua conta bancária</p>
            <div className="mb-4">
              <label className="text-xs block mb-1.5 text-white">Saldo inicial (R$)</label>
              <input autoFocus type="text" inputMode="numeric"
                value={saldoInput}
                onChange={e => setSaldoInput(e.target.value.replace(/[^0-9,]/g, ''))}
                onKeyDown={e => { if (e.key === 'Enter') saveSaldo(); if (e.key === 'Escape') setEditSaldo(false); }}
                placeholder="0,00" className="input-premium" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditSaldo(false)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={saveSaldo} className="btn-gold flex-1 text-center">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color, sub }) {
  return (
    <div className="rounded-2xl p-3.5 flex flex-col gap-1"
      style={{ background: 'linear-gradient(135deg, #1a2235 0%, #141920 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <span className="text-[9px] font-semibold tracking-widest uppercase text-white">{label}</span>
      <span className="font-bold leading-tight" style={{ fontSize: 14, color }}>
        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)}
      </span>
      {sub && <span className="text-[9px] text-white">{sub}</span>}
    </div>
  );
}
