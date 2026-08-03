import React, { useMemo, useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';

const fmt = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

// Paleta categórica validada (contraste + separação para daltonismo) contra o
// fundo real dos cards do app (#1e293b) — mesma ordem fixa nos dois rankings
// para manter a identidade visual consistente entre Despesas e Receitas.
const CATEGORICAL_COLORS = ['#3987e5','#d95926','#199e70','#c98500','#d55181','#008300','#9085e9','#e66767'];
const BAR_COLORS = CATEGORICAL_COLORS;
const INCOME_COLORS = CATEGORICAL_COLORS;

function CenteredYAxisTick({ x, y, payload }) {
  if (!payload || payload.value == null) return null;
  const words = String(payload.value).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= 9) { cur = next; }
    else { if (cur) lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  const lh = 11;
  const startDy = -((lines.length - 1) * lh) / 2;
  return (
    <text x={x - 45} y={y} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize={10}>
      {lines.map((line, i) => (
        <tspan key={i} x={x - 45} dy={i === 0 ? startDy : lh}>{line}</tspan>
      ))}
    </text>
  );
}

const DIVIDA_KEY = 'financeiro_dividas';
const RECEITA_KEY = 'financeiro_receitas';
const CARTAO_KEY = 'planeje_cartoes';
const FATURA_KEY = 'planeje_faturas';

function parcelaValor(d) {
  if (d.recorrencia === 'parcelar' && d.totalParcelas > 1) return d.valor / d.totalParcelas;
  return d.valor;
}

function statusMes(d, month, year) {
  if (d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const p = d.pagamentos && d.pagamentos[key];
    if (p) return { pago: !!p.pago };
    // Migração: dado antigo de "parcelar" guardava pago/pagamentoData num campo global.
    if (d.recorrencia === 'parcelar' && d.pago && d.pagamentoData) {
      const [py, pm] = d.pagamentoData.split('-').map(Number);
      if (py === year && pm === month) return { pago: true };
    }
    return { pago: false };
  }
  return { pago: !!d.pago };
}

function parcelaAbrangeMs(d, month, year) {
  const dateStr = d.vencimento;
  if (!dateStr) return false;
  const [vy, vm] = dateStr.split('-').map(Number);
  const inicio = vy * 12 + (vm - 1);
  const fim = inicio + ((d.totalParcelas || 1) - 1);
  const atual = year * 12 + (month - 1);
  return atual >= inicio && atual <= fim;
}

function loadTransacoes(month, year) {
  try {
    const all = JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]');
    return all
      .filter(d => {
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
      })
      .map(d => {
        const mm = String(month).padStart(2, '0');
        let date;
        if ((d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') && d.vencimento) {
          const day = d.vencimento.split('-')[2];
          date = `${year}-${mm}-${day}`;
        } else {
          date = d.pagamentoData || d.vencimento || `${year}-${mm}-01`;
        }
        return {
          id: 'div_' + d.id,
          type: 'expense',
          description: d.nome,
          category: d.categoria || 'Outros',
          amount: parcelaValor(d),
          date,
          pago: statusMes(d, month, year).pago,
        };
      });
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
      return {
        id: 'rec_' + r.id,
        type: 'income',
        description: r.nome,
        category: r.categoria || 'Outros',
        amount: parseFloat(r.valorRecebido || r.valor || 0),
        date,
      };
    });
  } catch { return []; }
}

// Fatura do cartão de crédito do mês — mesmo critério usado no Resumo, para
// que "Cartão de Crédito" apareça também no ranking de despesas dos Gráficos.
function loadFaturas(month, year) {
  try {
    const cartoes = JSON.parse(localStorage.getItem(CARTAO_KEY) || '[]');
    const lancs = JSON.parse(localStorage.getItem(FATURA_KEY) || '[]');
    return cartoes.map(c => {
      const total = lancs.filter(l => l.cartaoId === c.id && l.mes === month && l.ano === year)
        .reduce((s, l) => s + (l.valor / (l.parcelas || 1)), 0);
      if (total <= 0) return null;
      const mm = String(month).padStart(2, '0');
      const dia = String(c.diaPagamento || 10).padStart(2, '0');
      return {
        id: 'fat_' + c.id,
        type: 'expense',
        description: `Fatura ${c.nome}`,
        category: 'Cartão de Crédito',
        amount: total,
        date: `${year}-${mm}-${dia}`,
      };
    }).filter(Boolean);
  } catch { return []; }
}

const tooltipStyle = {
  contentStyle: { background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, fontSize: 11, padding: '8px 12px' },
  labelStyle: { color: '#ffffff', marginBottom: 4 },
  itemStyle: { color: '#ffffff' },
};

export default function Graficos({ month, year }) {
  const [syncVer, setSyncVer] = useState(0);
  useEffect(() => {
    const reload = () => setSyncVer(v => v + 1);
    window.addEventListener('planeje-sync', reload);
    return () => window.removeEventListener('planeje-sync', reload);
  }, []);

  const transactions = useMemo(() => [...loadTransacoes(month, year), ...loadReceitas(month, year), ...loadFaturas(month, year)], [month, year, syncVer]);
  const expenseByCategory = useMemo(() => {
    const bycat = {};
    transactions.filter(t => t.type === 'expense').forEach(tx => {
      const c = tx.category || 'Outros';
      bycat[c] = (bycat[c] || 0) + parseFloat(tx.amount || 0);
    });
    return Object.entries(bycat).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value }));
  }, [transactions]);

  const incomeByCategory = useMemo(() => {
    const bycat = {};
    transactions.filter(t => t.type === 'income').forEach(tx => {
      const c = tx.category || 'Outros';
      bycat[c] = (bycat[c] || 0) + parseFloat(tx.amount || 0);
    });
    return Object.entries(bycat).sort(([, a], [, b]) => b - a).map(([name, value]) => ({ name, value }));
  }, [transactions]);

  const totalExpense = expenseByCategory.reduce((s, d) => s + d.value, 0);
  const totalIncome = incomeByCategory.reduce((s, d) => s + d.value, 0);
  const hasData = expenseByCategory.length > 0 || incomeByCategory.length > 0;

  if (!hasData) {
    return (
      <div className="p-6 flex flex-col items-center justify-center py-28 text-text-3 animate-fade-in">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
        </div>
        <p className="font-medium text-text-2">Nenhum dado para exibir</p>
        <p className="text-sm mt-1">Adicione transações para ver os gráficos</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 pb-safe-nav space-y-4 animate-fade-in">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card-premium p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-expense" />
            <p className="text-white text-xs font-medium">Total Despesas</p>
          </div>
          <p className="hv text-expense font-bold text-xl">{fmt(totalExpense)}</p>
          <p className="text-white/70 text-[10px] mt-1">{expenseByCategory.length} categorias</p>
        </div>
        <div className="card-premium p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-income" />
            <p className="text-white text-xs font-medium">Total Receitas</p>
          </div>
          <p className="hv text-income font-bold text-xl">{fmt(totalIncome)}</p>
          <p className="text-text-3 text-[10px] mt-1">{incomeByCategory.length} categorias</p>
        </div>
      </div>

      {/* Ranking de Despesas */}
      {expenseByCategory.length > 0 && (
        <RankingBarChart title="Ranking de Despesas" data={expenseByCategory} total={totalExpense} colors={BAR_COLORS} />
      )}

      {/* Ranking de Receitas */}
      {incomeByCategory.length > 0 && (
        <RankingBarChart title="Ranking de Receitas" data={incomeByCategory} total={totalIncome} colors={INCOME_COLORS} />
      )}
    </div>
  );
}

function RankingBarChart({ title, data, total, colors }) {
  return (
    <div className="card-premium p-4">
      <h3 className="text-text-1 text-sm font-semibold mb-4">{title}</h3>
      <div className="hv">
        <ResponsiveContainer width="100%" height={Math.max(160, data.length * 34)}>
          <BarChart data={data} layout="vertical" margin={{ left: 0, right: 115, top: 0, bottom: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" tick={<CenteredYAxisTick width={90} />} axisLine={false} tickLine={false} width={90} />
            <Tooltip {...tooltipStyle} cursor={{ fill: 'rgba(255,255,255,0.04)' }} formatter={(v) => [fmt(v), 'Total']} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]}>
              <LabelList
                dataKey="value"
                content={({ x, y, width, height, index }) => {
                  if (width < 4) return null;
                  const d = data[index];
                  if (!d) return null;
                  const pct = total > 0 ? Math.round(d.value / total * 100) : 0;
                  const fullText = `${fmt(d.value)} · ${pct}%`;
                  const fitsInside = width >= fullText.length * 6.2 + 12;
                  if (fitsInside) {
                    return (
                      <text x={x + width / 2} y={y + height / 2} fill="#ffffff" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
                        {fullText}
                      </text>
                    );
                  }
                  return (
                    <text x={x + width + 6} y={y + height / 2} fill="rgba(255,255,255,0.75)" textAnchor="start" dominantBaseline="central" fontSize={10} fontWeight={500}>
                      {fullText}
                    </text>
                  );
                }}
              />
              {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
