import React, { useState, useMemo, useEffect } from 'react';

const fmt = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
const fmtFull = (d) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const fmtShort = (d) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

const EFETIVAR_KEY = 'financeiro_efetivacoes';
const DIVIDA_KEY = 'financeiro_dividas';

function loadEfetivacoes() { try { return JSON.parse(localStorage.getItem(EFETIVAR_KEY) || '{}'); } catch { return {}; } }
function saveEfetivacoes(obj) { localStorage.setItem(EFETIVAR_KEY, JSON.stringify(obj)); }

function loadDividas() {
  try { return JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]'); } catch { return []; }
}

// Converte dívida para formato de registro unificado
function dividaToRecord(d) {
  const date = d.pagamentoData || d.vencimento || new Date().toISOString().split('T')[0];
  return {
    id: 'div_' + d.id,
    _dividaId: d.id,
    type: 'expense',
    isDivida: true,
    description: d.nome,
    category: d.categoria || 'Outros',
    amount: d.valor,
    date,
    pago: d.pago,
    pagamentoData: d.pagamentoData,
    vencimento: d.vencimento,
    recorrencia: d.recorrencia,
    parcelaInicial: d.parcelaInicial,
    totalParcelas: d.totalParcelas,
    periodicidade: d.periodicidade,
  };
}

export default function Transacoes({ transactions, onDelete, loading, onAdd }) {
  const [tab, setTab] = useState('despesas');
  const [confirmId, setConfirmId] = useState(null);
  const [search, setSearch] = useState('');
  const [efetivacoes, setEfetivacoes] = useState(loadEfetivacoes);
  const [dividas, setDividas] = useState(loadDividas);

  useEffect(() => {
    const reload = () => { setEfetivacoes(loadEfetivacoes()); setDividas(loadDividas()); };
    window.addEventListener('planeje-sync', reload);
    return () => window.removeEventListener('planeje-sync', reload);
  }, []);
  const [efetivandoId, setEfetivandoId] = useState(null);
  const [efetivDate, setEfetivDate] = useState('');
  const [efetivIsDivida, setEfetivIsDivida] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  // Mescla transações do backend + dívidas
  const allRecords = useMemo(() => {
    const dividaRecords = dividas.map(dividaToRecord);
    return [...transactions, ...dividaRecords];
  }, [transactions, dividas]);

  const filtered = useMemo(() => {
    let base;
    if (tab === 'extrato') {
      base = allRecords;
    } else if (tab === 'despesas') {
      base = allRecords.filter(t => t.type === 'expense');
    } else {
      base = allRecords.filter(t => t.type === 'income');
    }
    if (!search) return base;
    const q = search.toLowerCase();
    return base.filter(t =>
      t.description.toLowerCase().includes(q) || (t.category || '').toLowerCase().includes(q)
    );
  }, [allRecords, tab, search]);

  const total = filtered.reduce((s, t) => s + parseFloat(t.amount), 0);

  // Agrupa por dia para o Extrato
  const byDay = useMemo(() => {
    const groups = {};
    filtered.forEach(tx => {
      const d = tx.date.slice(0, 10);
      if (!groups[d]) groups[d] = [];
      groups[d].push(tx);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [filtered]);

  const openEfetivar = (record) => {
    const isDivida = record.isDivida;
    setEfetivIsDivida(isDivida);
    if (isDivida) {
      setEfetivDate(record.pagamentoData || today);
      setEfetivandoId(record._dividaId);
    } else {
      setEfetivDate(efetivacoes[record.id] || today);
      setEfetivandoId(record.id);
    }
  };

  const confirmEfetivar = () => {
    if (!efetivandoId) return;
    if (efetivIsDivida) {
      const updated = dividas.map(d =>
        d.id === efetivandoId ? { ...d, pago: true, pagamentoData: efetivDate, updatedAt: new Date().toISOString() } : d
      );
      setDividas(updated);
      localStorage.setItem(DIVIDA_KEY, JSON.stringify(updated));
    } else {
      const updated = { ...efetivacoes, [efetivandoId]: efetivDate };
      setEfetivacoes(updated);
      saveEfetivacoes(updated);
    }
    setEfetivandoId(null);
  };

  const removeEfetivacao = (record) => {
    if (record.isDivida) {
      const updated = dividas.map(d =>
        d.id === record._dividaId ? { ...d, pago: false, pagamentoData: null, updatedAt: new Date().toISOString() } : d
      );
      setDividas(updated);
      localStorage.setItem(DIVIDA_KEY, JSON.stringify(updated));
    } else {
      const updated = { ...efetivacoes };
      delete updated[record.id];
      setEfetivacoes(updated);
      saveEfetivacoes(updated);
    }
  };

  const isEfetivado = (record) => {
    if (record.isDivida) return record.pago && record.pagamentoData;
    return !!efetivacoes[record.id];
  };

  const efetivadoDate = (record) => {
    if (record.isDivida) return record.pagamentoData;
    return efetivacoes[record.id];
  };

  const recLabel = (record) => {
    if (!record.isDivida || !record.recorrencia || record.recorrencia === 'nao') return null;
    if (record.recorrencia === 'fixa') return `Fixa ${record.periodicidade || 'Mensal'}`;
    return `${record.parcelaInicial}/${record.totalParcelas}x ${record.periodicidade || 'Mensal'}`;
  };

  const TABS = [
    { id: 'despesas', label: 'Despesas' },
    { id: 'receitas', label: 'Receitas' },
    { id: 'extrato', label: 'Extrato' },
  ];

  return (
    <div className="p-4 md:p-6 pb-safe-nav animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-text-1 font-bold text-lg">Transações</h2>
        <button onClick={onAdd} className="btn-gold flex items-center gap-1.5 py-2 px-4 text-sm">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/></svg>
          Nova
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {TABS.map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={tab === id ? {
              background: id === 'despesas' ? 'rgba(244,63,94,0.15)' : id === 'receitas' ? 'rgba(34,197,94,0.12)' : 'rgba(201,168,76,0.12)',
              color: id === 'despesas' ? '#f43f5e' : id === 'receitas' ? '#22c55e' : '#c9a84c',
              border: `1px solid ${id === 'despesas' ? 'rgba(244,63,94,0.25)' : id === 'receitas' ? 'rgba(34,197,94,0.2)' : 'rgba(201,168,76,0.2)'}`,
            } : { color: 'rgba(255,255,255,0.45)', border: '1px solid transparent' }}
          >{label}</button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-3" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por descrição ou categoria..."
          className="input-premium pl-9" />
      </div>

      {/* Count + total */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-text-3 text-xs">{filtered.length} {filtered.length === 1 ? 'registro' : 'registros'}</span>
        <span className={`text-sm font-bold ${tab === 'despesas' ? 'text-expense' : tab === 'receitas' ? 'text-income' : 'text-text-2'}`}>
          {fmt(total)}
        </span>
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-14 skeleton" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-7 h-7"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
          </div>
          <p className="text-sm">Nenhum registro encontrado</p>
        </div>
      ) : tab === 'extrato' ? (
        /* ─── Extrato: agrupado por dia ─── */
        <div className="space-y-4">
          {byDay.map(([date, recs]) => {
            const dayIncome = recs.filter(t => t.type === 'income').reduce((s, t) => s + parseFloat(t.amount), 0);
            const dayExpense = recs.filter(t => t.type === 'expense').reduce((s, t) => s + parseFloat(t.amount), 0);
            const dayBalance = dayIncome - dayExpense;
            return (
              <div key={date}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-text-2 text-xs font-semibold capitalize">{fmtFull(date)}</p>
                  <span className={`text-xs font-semibold ${dayBalance >= 0 ? 'text-income' : 'text-expense'}`}>
                    {dayBalance >= 0 ? '+' : ''}{fmt(dayBalance)}
                  </span>
                </div>
                <div className="card-premium overflow-hidden">
                  {recs.map((tx, i) => (
                    <RecordRow key={tx.id} record={tx} last={i === recs.length - 1}
                      isEfetivado={isEfetivado(tx)} efetivadoDate={efetivadoDate(tx)}
                      recLabel={recLabel(tx)}
                      onEfetivar={() => openEfetivar(tx)}
                      onRemoveEfetivar={() => removeEfetivacao(tx)}
                      onDelete={!tx.isDivida ? () => setConfirmId(tx.id) : null}
                      confirmId={confirmId} setConfirmId={setConfirmId}
                      onDeleteConfirm={() => { onDelete(tx.id); setConfirmId(null); }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ─── Despesas / Receitas ─── */
        <>
          {/* Desktop */}
          <div className="hidden md:block card-premium overflow-hidden">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <th className="text-left text-text-3 text-xs font-medium px-4 py-3">Descrição</th>
                  <th className="text-left text-text-3 text-xs font-medium px-4 py-3">Categoria</th>
                  <th className="text-left text-text-3 text-xs font-medium px-4 py-3">Data</th>
                  <th className="text-center text-text-3 text-xs font-medium px-4 py-3">Status</th>
                  <th className="text-right text-text-3 text-xs font-medium px-4 py-3">Valor</th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx, i) => {
                  const ef = isEfetivado(tx);
                  const efDate = efetivadoDate(tx);
                  const rec = recLabel(tx);
                  return (
                    <tr key={tx.id} className="hover:bg-white/2 transition-colors"
                      style={{ borderBottom: i === filtered.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {tx.isDivida && (
                            <span className="badge text-[10px] text-gold flex-shrink-0"
                              style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.18)' }}>
                              Dívida
                            </span>
                          )}
                          <p className="text-text-1 text-sm font-medium">{tx.description}</p>
                          {rec && <span className="badge text-[10px] text-gold" style={{ background: 'rgba(201,168,76,0.08)' }}>{rec}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge text-text-3" style={{ background: 'rgba(255,255,255,0.06)' }}>{tx.category || 'Outros'}</span>
                      </td>
                      <td className="px-4 py-3 text-text-3 text-sm">{fmtShort(tx.date)}</td>
                      <td className="px-4 py-3 text-center">
                        {ef ? (
                          <div className="flex items-center justify-center gap-1">
                            <span className="badge text-income text-[10px]"
                              style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                              Pago {fmtShort(efDate)}
                            </span>
                            <button onClick={() => removeEfetivacao(tx)} className="text-text-3 hover:text-expense text-xs leading-none">×</button>
                          </div>
                        ) : (
                          <button onClick={() => openEfetivar(tx)}
                            className="text-xs font-semibold px-2.5 py-1 rounded-lg text-gold hover:opacity-80"
                            style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}>
                            Efetivar
                          </button>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right text-sm font-semibold ${tx.type === 'expense' ? 'text-expense' : 'text-income'}`}>
                        {tx.type === 'expense' ? '-' : '+'}{fmt(tx.amount)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!tx.isDivida && (
                          confirmId === tx.id ? (
                            <div className="flex items-center gap-1.5 justify-end">
                              <button onClick={() => { onDelete(tx.id); setConfirmId(null); }} className="text-expense text-xs font-bold hover:underline">Excluir</button>
                              <button onClick={() => setConfirmId(null)} className="text-text-3 text-xs hover:underline">Cancelar</button>
                            </div>
                          ) : (
                            <button onClick={() => setConfirmId(tx.id)} className="text-text-3 hover:text-expense transition text-xl leading-none px-1">⋯</button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-2">
            {filtered.map(tx => {
              const ef = isEfetivado(tx);
              const efDate = efetivadoDate(tx);
              const rec = recLabel(tx);
              return (
                <div key={tx.id} className="card-premium px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${tx.type === 'income' ? 'text-income' : 'text-expense'}`}
                      style={{ background: tx.isDivida ? 'rgba(201,168,76,0.08)' : tx.type === 'income' ? 'rgba(34,197,94,0.1)' : 'rgba(244,63,94,0.1)' }}>
                      {tx.isDivida ? '₢' : tx.type === 'income' ? '↑' : '↓'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-text-1 text-sm font-medium truncate">{tx.description}</p>
                        {tx.isDivida && <span className="badge text-[9px] text-gold" style={{ background: 'rgba(201,168,76,0.08)' }}>Dívida</span>}
                        {rec && <span className="badge text-[9px] text-gold" style={{ background: 'rgba(201,168,76,0.08)' }}>{rec}</span>}
                      </div>
                      <p className="text-text-3 text-xs">{tx.category || 'Outros'} · {fmtShort(tx.date)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-sm font-semibold ${tx.type === 'income' ? 'text-income' : 'text-expense'}`}>
                        {tx.type === 'expense' ? '-' : '+'}{fmt(tx.amount)}
                      </span>
                      {!tx.isDivida && (
                        confirmId === tx.id ? (
                          <div className="flex gap-1">
                            <button onClick={() => { onDelete(tx.id); setConfirmId(null); }} className="text-expense text-xs font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(244,63,94,0.1)' }}>✓</button>
                            <button onClick={() => setConfirmId(null)} className="text-text-3 text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>✕</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmId(tx.id)} className="text-text-3 text-xl leading-none px-1">⋯</button>
                        )
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {ef ? (
                      <>
                        <span className="badge text-income text-[10px]" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)' }}>
                          Pago {fmtShort(efDate)}
                        </span>
                        <button onClick={() => removeEfetivacao(tx)} className="text-text-3 hover:text-expense text-xs">Desfazer</button>
                      </>
                    ) : (
                      <button onClick={() => openEfetivar(tx)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg text-gold"
                        style={{ background: 'rgba(201,168,76,0.08)', border: '1px solid rgba(201,168,76,0.18)' }}>
                        Efetivar pagamento
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Efetivar date modal */}
      {efetivandoId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative card-premium p-6 w-full max-w-xs animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: efetivIsDivida ? 'rgba(34,197,94,0.1)' : 'rgba(201,168,76,0.1)' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className={`w-5 h-5 ${efetivIsDivida ? 'text-income' : 'text-gold'}`}>
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/>
                </svg>
              </div>
              <div>
                <h3 className="text-text-1 font-semibold">Efetivar pagamento</h3>
                <p className="text-text-3 text-xs">Informe a data do pagamento</p>
              </div>
            </div>
            <div className="mb-4">
              <label className="text-text-3 text-xs block mb-1.5">Data do pagamento</label>
              <input type="date" value={efetivDate} onChange={e => setEfetivDate(e.target.value)}
                className="input-premium [color-scheme:dark]" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEfetivandoId(null)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={confirmEfetivar} className="btn-gold flex-1 text-center">Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordRow({ record: tx, last, isEfetivado, efetivadoDate, recLabel, onEfetivar, onRemoveEfetivar, onDelete, confirmId, setConfirmId, onDeleteConfirm }) {
  return (
    <div className="px-4 py-3" style={{ borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex items-center gap-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${tx.type === 'income' ? 'text-income' : 'text-expense'}`}
          style={{ background: tx.isDivida ? 'rgba(201,168,76,0.08)' : tx.type === 'income' ? 'rgba(34,197,94,0.1)' : 'rgba(244,63,94,0.1)' }}>
          {tx.isDivida ? '₢' : tx.type === 'income' ? '↑' : '↓'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-text-1 text-sm font-medium truncate">{tx.description}</p>
            {tx.isDivida && <span className="badge text-[9px] text-gold" style={{ background: 'rgba(201,168,76,0.08)' }}>Dívida</span>}
            {recLabel && <span className="badge text-[9px] text-gold" style={{ background: 'rgba(201,168,76,0.08)' }}>{recLabel}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-text-3 text-[10px]">{tx.category || 'Outros'}</span>
            {isEfetivado ? (
              <div className="flex items-center gap-1">
                <span className="badge text-income text-[10px]" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.18)' }}>
                  Pago {(() => { try { return new Date(efetivadoDate + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return efetivadoDate; } })()}
                </span>
                <button onClick={onRemoveEfetivar} className="text-text-3 hover:text-expense text-[10px] transition">Desfazer</button>
              </div>
            ) : (
              <button onClick={onEfetivar} className="text-[10px] text-gold hover:text-gold-light transition">Efetivar</button>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className={`text-sm font-semibold ${tx.type === 'income' ? 'text-income' : 'text-expense'}`}>
            {tx.type === 'income' ? '+' : '-'}{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(tx.amount || 0)}
          </p>
          <p className="text-text-3 text-[10px]">
            {(() => { try { return new Date(tx.date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); } catch { return tx.date; } })()}
          </p>
        </div>
        {onDelete && (
          <div className="flex-shrink-0">
            {confirmId === tx.id ? (
              <div className="flex gap-1">
                <button onClick={onDeleteConfirm} className="text-expense text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(244,63,94,0.1)' }}>✓</button>
                <button onClick={() => setConfirmId(null)} className="text-text-3 text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.05)' }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setConfirmId(tx.id)} className="text-text-3 hover:text-expense transition text-xl leading-none px-1">⋯</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
