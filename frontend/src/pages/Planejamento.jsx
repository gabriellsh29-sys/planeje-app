import React, { useState, useMemo } from 'react';
import { AppIcon, GOAL_ICONS } from '../lib/icons';

const ORCAMENTO_KEY = 'planeje_orcamentos';
const METAS_KEY     = 'planeje_metas';
const DIVIDA_KEY    = 'financeiro_dividas';
const CATEGORIAS_KEY = 'planeje_categorias_orcamento';

const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return d; } };

const CORES = ['#22c55e','#3b82f6','#f59e0b','#a855f7','#06b6d4','#f43f5e','#c9a84c','#34d399'];

function load(key, fb) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; } catch { return fb; } }
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function getGastoFatura(month, year) {
  try {
    const lancs = JSON.parse(localStorage.getItem('planeje_faturas') || '[]');
    return lancs.filter(l => l.mes === month && l.ano === year)
      .reduce((s, l) => s + (l.valor / (l.parcelas || 1)), 0);
  } catch { return 0; }
}

function getGastoCategoria(categoria, month, year) {
  try {
    const dividas = JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]');
    const baseDividas = dividas.filter(d => {
      if (d.categoria !== categoria) return false;
      if (d.recorrencia === 'fixa') {
        if (!d.vencimento) return true;
        const [vy, vm] = d.vencimento.split('-').map(Number);
        return (year * 12 + (month - 1)) >= (vy * 12 + (vm - 1));
      }
      if (d.recorrencia === 'parcelar') {
        if (!d.vencimento) return false;
        const [vy, vm] = d.vencimento.split('-').map(Number);
        const inicio = vy * 12 + (vm - 1);
        const fim = inicio + ((d.totalParcelas || 1) - 1);
        const atual = year * 12 + (month - 1);
        return atual >= inicio && atual <= fim;
      }
      const ds = d.pagamentoData || d.vencimento;
      if (!ds) return false;
      const [y, m] = ds.split('-').map(Number);
      return y === year && m === month;
    }).reduce((s, d) => {
      const val = (d.recorrencia === 'parcelar' && d.totalParcelas > 1) ? d.valor / d.totalParcelas : d.valor;
      return s + val;
    }, 0);
    if (categoria === 'Cartão de Crédito') return baseDividas + getGastoFatura(month, year);
    return baseDividas;
  } catch { return 0; }
}

function getCategoriasDividas() {
  try {
    const dividas = JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]');
    return [...new Set(dividas.map(d => d.categoria).filter(Boolean))].sort();
  } catch { return []; }
}

// ── ORÇAMENTO ────────────────────────────────────────────────────────────────
function Orcamento({ month, year }) {
  const [orcamentos, setOrcamentos] = useState(() => load(ORCAMENTO_KEY, []));
  const [showForm, setShowForm]     = useState(false);
  const [editId, setEditId]         = useState(null);
  const [formCateg, setFormCateg]   = useState('');
  const [formLimite, setFormLimite] = useState('');
  const [novaCategoria, setNovaCategoria] = useState('');
  const [categoriasExtra, setCategoriasExtra] = useState(() => load(CATEGORIAS_KEY, []));

  const categoriasDividas = useMemo(getCategoriasDividas, []);

  const salvar = () => {
    let categoria = formCateg;
    if (categoria === '__nova__') {
      categoria = novaCategoria.trim();
      if (!categoria) return;
      if (!categoriasExtra.includes(categoria)) {
        const updatedCats = [...categoriasExtra, categoria];
        setCategoriasExtra(updatedCats); save(CATEGORIAS_KEY, updatedCats);
      }
    }
    if (!categoria || !formLimite) return;
    const limite = parseFloat(formLimite.replace(',', '.')) || 0;
    if (!limite) return;
    const item = { id: editId || Date.now().toString(), categoria, limite };
    const updated = editId
      ? orcamentos.map(o => o.id === editId ? item : o)
      : [...orcamentos, item];
    setOrcamentos(updated); save(ORCAMENTO_KEY, updated);
    setShowForm(false); setEditId(null); setFormCateg(''); setFormLimite(''); setNovaCategoria('');
  };

  const remover = (id) => { const u = orcamentos.filter(o => o.id !== id); setOrcamentos(u); save(ORCAMENTO_KEY, u); };

  const openEdit = (o) => { setFormCateg(o.categoria); setFormLimite(o.limite.toFixed(2)); setNovaCategoria(''); setEditId(o.id); setShowForm(true); };

  const totalLimite = orcamentos.reduce((s, o) => s + o.limite, 0);
  const totalGasto  = orcamentos.reduce((s, o) => s + getGastoCategoria(o.categoria, month, year), 0);

  return (
    <div className="p-4 md:p-6 pb-8 space-y-4">
      {/* Resumo geral */}
      {orcamentos.length > 0 && (
        <div className="rounded-2xl p-5"
          style={{ background: 'linear-gradient(135deg, #1a2235 0%, #141920 100%)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-3">Visão Geral do Mês</p>
          <div className="flex items-end justify-between mb-3">
            <div>
              <p className="text-white/70 text-xs">Gasto total</p>
              <p className="text-white font-bold text-2xl">{fmt(totalGasto)}</p>
            </div>
            <div className="text-right">
              <p className="text-white/70 text-xs">Orçamento total</p>
              <p className="font-bold text-lg" style={{ color: totalGasto > totalLimite ? '#f43f5e' : '#22c55e' }}>{fmt(totalLimite)}</p>
            </div>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, totalLimite > 0 ? (totalGasto / totalLimite * 100) : 0)}%`,
                background: totalGasto > totalLimite ? '#f43f5e' : totalGasto > totalLimite * 0.8 ? '#f59e0b' : '#22c55e' }} />
          </div>
          <p className="text-white/50 text-[10px] mt-1.5">
            {totalLimite > 0 ? `${Math.round(totalGasto / totalLimite * 100)}% do orçamento utilizado` : 'Nenhum orçamento definido'}
          </p>
        </div>
      )}

      {/* Botão novo */}
      <button onClick={() => { setShowForm(true); setEditId(null); setFormCateg(''); setFormLimite(''); setNovaCategoria(''); }}
        className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
        style={{ background: 'rgba(201,168,76,0.1)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.2)' }}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/></svg>
        Definir limite por categoria
      </button>

      {/* Lista orçamentos */}
      {orcamentos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-white/40">
          <span className="text-4xl mb-3 opacity-40">📊</span>
          <p className="text-sm text-white/60 font-medium">Nenhum orçamento definido</p>
          <p className="text-xs mt-1">Defina limites por categoria para controlar gastos</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orcamentos.map((o, i) => {
            const gasto = getGastoCategoria(o.categoria, month, year);
            const pct   = o.limite > 0 ? Math.min(100, gasto / o.limite * 100) : 0;
            const cor   = pct >= 100 ? '#f43f5e' : pct >= 80 ? '#f59e0b' : '#22c55e';
            const sobra = o.limite - gasto;
            return (
              <div key={o.id} className="card-premium p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-white font-semibold text-sm">{o.categoria}</p>
                    <p className="text-white/50 text-xs mt-0.5">
                      {fmt(gasto)} de {fmt(o.limite)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{ background: cor + '18', color: cor, border: `1px solid ${cor}33` }}>
                      {Math.round(pct)}%
                    </span>
                    <button onClick={() => openEdit(o)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-gold hover:bg-white/5 transition">
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M12.854.146a.5.5 0 00-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 000-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 016 13.5V13h-.5a.5.5 0 01-.5-.5V12h-.5a.5.5 0 01-.5-.5V11h-.5a.5.5 0 01-.5-.5V10h-.5a.499.499 0 01-.175-.032l-.179.178a.5.5 0 00-.11.168l-2 5a.5.5 0 00.65.65l5-2a.5.5 0 00.168-.11l.178-.178z"/></svg>
                    </button>
                    <button onClick={() => remover(o.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-expense hover:bg-white/5 transition">
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" clipRule="evenodd"/></svg>
                    </button>
                  </div>
                </div>
                <div className="h-2 rounded-full overflow-hidden mb-1" style={{ background: 'rgba(255,255,255,0.07)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: cor }} />
                </div>
                <p className="text-[10px]" style={{ color: sobra >= 0 ? 'rgba(255,255,255,0.5)' : '#f43f5e' }}>
                  {sobra >= 0 ? `Disponível: ${fmt(sobra)}` : `Excedido em ${fmt(Math.abs(sobra))}`}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal novo orçamento */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative w-full max-w-sm rounded-t-[1.75rem] md:rounded-[1.5rem] overflow-hidden animate-scale-in"
            style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={e => e.stopPropagation()}>
            <div className="md:hidden flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} /></div>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <h3 className="text-white font-semibold">{editId ? 'Editar orçamento' : 'Novo orçamento'}</h3>
              <button onClick={() => setShowForm(false)} className="w-7 h-7 flex items-center justify-center rounded-lg text-white/40 hover:text-white transition">×</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Categoria</label>
                <select value={formCateg} onChange={e => setFormCateg(e.target.value)}
                  className="input-premium [color-scheme:dark]">
                  <option value="">Selecione...</option>
                  {[...new Set([...categoriasDividas, ...categoriasExtra, 'Cartão de Crédito','Empréstimo','Financiamento','Alimentação','Transporte','Saúde','Lazer','Outros'])].map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  <option value="__nova__">+ Nova categoria...</option>
                </select>
              </div>
              {formCateg === '__nova__' && (
                <div>
                  <label className="text-white/50 text-xs block mb-1.5">Nome da nova categoria</label>
                  <input value={novaCategoria} onChange={e => setNovaCategoria(e.target.value)}
                    placeholder="Ex: Educação dos filhos" className="input-premium" />
                </div>
              )}
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Limite mensal (R$)</label>
                <input type="number" step="0.01" value={formLimite} onChange={e => setFormLimite(e.target.value)}
                  placeholder="0,00" className="input-premium" />
              </div>
              <div className="flex gap-3 pb-2">
                <button onClick={() => setShowForm(false)} className="btn-ghost flex-1">Cancelar</button>
                <button onClick={salvar} disabled={!formCateg || !formLimite || (formCateg === '__nova__' && !novaCategoria.trim())}
                  className="btn-gold flex-1 text-center disabled:opacity-40">Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── METAS ────────────────────────────────────────────────────────────────────
function Metas() {
  const [metas,    setMetas]    = useState(() => load(METAS_KEY, []));
  const [showForm, setShowForm] = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [showDep,  setShowDep]  = useState(null);
  const [depValor, setDepValor] = useState('');
  const [form, setForm] = useState({ nome: '', valorAlvo: '', prazo: '', emoji: 'target', cor: CORES[0] });

  const upd = (p) => setForm(f => ({ ...f, ...p }));

  const salvar = () => {
    if (!form.nome.trim() || !form.valorAlvo) return;
    const item = {
      id: editId || Date.now().toString(),
      nome: form.nome.trim(),
      valorAlvo: parseFloat(form.valorAlvo.replace(',','.')) || 0,
      valorAtual: editId ? (metas.find(m => m.id === editId)?.valorAtual || 0) : 0,
      prazo: form.prazo, emoji: form.emoji, cor: form.cor,
      criadoEm: editId ? (metas.find(m => m.id === editId)?.criadoEm || new Date().toISOString()) : new Date().toISOString(),
    };
    const updated = editId ? metas.map(m => m.id === editId ? item : m) : [...metas, item];
    setMetas(updated); save(METAS_KEY, updated);
    setShowForm(false); setEditId(null); setForm({ nome: '', valorAlvo: '', prazo: '', emoji: 'target', cor: CORES[0] });
  };

  const remover = (id) => { const u = metas.filter(m => m.id !== id); setMetas(u); save(METAS_KEY, u); };

  const openEdit = (m) => {
    setForm({ nome: m.nome, valorAlvo: m.valorAlvo.toFixed(2), prazo: m.prazo || '', emoji: m.emoji || 'target', cor: m.cor || CORES[0] });
    setEditId(m.id); setShowForm(true);
  };

  const depositar = (id) => {
    const valor = parseFloat(depValor.replace(',','.')) || 0;
    if (!valor) return;
    const updated = metas.map(m => m.id === id ? { ...m, valorAtual: Math.min(m.valorAlvo, (m.valorAtual || 0) + valor) } : m);
    setMetas(updated); save(METAS_KEY, updated); setShowDep(null); setDepValor('');
  };

  const diasRestantes = (prazo) => {
    if (!prazo) return null;
    const diff = Math.ceil((new Date(prazo + 'T00:00:00') - new Date()) / 86400000);
    return diff;
  };

  return (
    <div className="p-4 md:p-6 pb-8 space-y-4">
      <button onClick={() => { setShowForm(true); setEditId(null); setForm({ nome: '', valorAlvo: '', prazo: '', emoji: 'target', cor: CORES[0] }); }}
        className="w-full py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/></svg>
        Nova meta de poupança
      </button>

      {metas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-white/40">
          <span className="text-4xl mb-3 opacity-40">🎯</span>
          <p className="text-sm text-white/60 font-medium">Nenhuma meta criada</p>
          <p className="text-xs mt-1">Defina objetivos e acompanhe seu progresso</p>
        </div>
      ) : (
        <div className="space-y-3">
          {metas.map(m => {
            const pct  = m.valorAlvo > 0 ? Math.min(100, (m.valorAtual || 0) / m.valorAlvo * 100) : 0;
            const dias = diasRestantes(m.prazo);
            const concluida = pct >= 100;
            return (
              <div key={m.id} className="card-premium p-4">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                    style={{ background: m.cor + '18', border: `1px solid ${m.cor}33` }}>
                    <AppIcon id={m.emoji} className="w-5 h-5" style={{ color: m.cor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-semibold text-sm">{m.nome}</p>
                      {concluida && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>✓ Concluída</span>}
                    </div>
                    {m.prazo && (
                      <p className="text-white/50 text-xs mt-0.5">
                        Prazo: {fmtDate(m.prazo)}
                        {dias !== null && !concluida && (
                          <span style={{ color: dias < 0 ? '#f43f5e' : dias <= 30 ? '#f59e0b' : 'rgba(255,255,255,0.5)' }}>
                            {' '}· {dias < 0 ? `${Math.abs(dias)}d atrasado` : dias === 0 ? 'Hoje!' : `${dias}d restantes`}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => openEdit(m)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-gold hover:bg-white/5 transition">
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M12.854.146a.5.5 0 00-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 000-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 016 13.5V13h-.5a.5.5 0 01-.5-.5V12h-.5a.5.5 0 01-.5-.5V11h-.5a.5.5 0 01-.5-.5V10h-.5a.499.499 0 01-.175-.032l-.179.178a.5.5 0 00-.11.168l-2 5a.5.5 0 00.65.65l5-2a.5.5 0 00.168-.11l.178-.178z"/></svg>
                    </button>
                    <button onClick={() => remover(m.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-expense hover:bg-white/5 transition">
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" clipRule="evenodd"/></svg>
                    </button>
                  </div>
                </div>

                {/* Progresso */}
                <div className="mb-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-white/70 text-xs">{fmt(m.valorAtual || 0)}</span>
                    <span className="text-white/50 text-xs">{fmt(m.valorAlvo)}</span>
                  </div>
                  <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, background: concluida ? '#22c55e' : m.cor }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-white/40 text-[10px]">{Math.round(pct)}% guardado</span>
                    {!concluida && <span className="text-white/40 text-[10px]">faltam {fmt(m.valorAlvo - (m.valorAtual || 0))}</span>}
                  </div>
                </div>

                {/* Depositar */}
                {!concluida && (
                  showDep === m.id ? (
                    <div className="flex gap-2 mt-2">
                      <input autoFocus type="number" step="0.01" value={depValor} onChange={e => setDepValor(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') depositar(m.id); if (e.key === 'Escape') setShowDep(null); }}
                        placeholder="R$ valor..." className="input-premium flex-1 text-sm" />
                      <button onClick={() => depositar(m.id)} className="btn-gold py-1.5 px-3 text-xs">+ Guardar</button>
                      <button onClick={() => setShowDep(null)} className="btn-ghost py-1.5 px-2 text-xs">✕</button>
                    </div>
                  ) : (
                    <button onClick={() => { setShowDep(m.id); setDepValor(''); }}
                      className="mt-2 text-xs font-semibold px-3 py-1.5 rounded-lg w-full text-center transition-all"
                      style={{ background: m.cor + '12', color: m.cor, border: `1px solid ${m.cor}30` }}>
                      + Adicionar ao cofrinho
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal nova meta */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative w-full max-w-md rounded-t-[1.75rem] md:rounded-[1.5rem] overflow-hidden"
            style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div className="md:hidden flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} /></div>
            <div className="sticky top-0 flex items-center justify-between px-5 py-4 z-10"
              style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white transition">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
              </button>
              <h3 className="text-white font-semibold">{editId ? 'Editar Meta' : 'Nova Meta'}</h3>
              <button onClick={salvar} disabled={!form.nome.trim() || !form.valorAlvo}
                className="btn-gold py-1.5 px-4 text-sm disabled:opacity-40">Salvar</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Emoji + cor */}
              <div className="flex items-center gap-3">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                  style={{ background: form.cor + '18', border: `1px solid ${form.cor}33` }}>
                  <AppIcon id={form.emoji} className="w-6 h-6" style={{ color: form.cor }} />
                </div>
                <div className="flex-1">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {GOAL_ICONS.map(iconId => (
                      <button key={iconId} onClick={() => upd({ emoji: iconId })}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${form.emoji === iconId ? 'bg-white/15 scale-110' : 'hover:bg-white/10'}`}>
                        <AppIcon id={iconId} className="w-4 h-4" />
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    {CORES.map(c => (
                      <button key={c} onClick={() => upd({ cor: c })}
                        className="w-6 h-6 rounded-full transition-transform flex items-center justify-center"
                        style={{ background: c, transform: form.cor === c ? 'scale(1.25)' : 'scale(1)', border: form.cor === c ? '2px solid white' : '2px solid transparent' }}>
                        {form.cor === c && <span className="text-white text-[8px] font-bold">✓</span>}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Nome da meta</label>
                <input value={form.nome} onChange={e => upd({ nome: e.target.value })}
                  placeholder="Ex: Viagem para Europa, Novo carro..." className="input-premium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/50 text-xs block mb-1.5">Valor alvo (R$)</label>
                  <input type="number" step="0.01" value={form.valorAlvo} onChange={e => upd({ valorAlvo: e.target.value })}
                    placeholder="0,00" className="input-premium" />
                </div>
                <div>
                  <label className="text-white/50 text-xs block mb-1.5">Prazo (opcional)</label>
                  <input type="date" value={form.prazo} onChange={e => upd({ prazo: e.target.value })}
                    className="input-premium [color-scheme:dark]" />
                </div>
              </div>
              <div className="pb-2" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PAGE PRINCIPAL ────────────────────────────────────────────────────────────
export default function Planejamento({ month, year }) {
  const [tab, setTab] = useState('orcamento');

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Tabs */}
      <div className="flex gap-0 px-4 pt-4 pb-0 flex-shrink-0">
        {[['orcamento','📊 Orçamento'],['metas','🎯 Metas']].map(([val, lbl]) => (
          <button key={val} onClick={() => setTab(val)}
            className="flex-1 py-2.5 text-sm font-semibold transition-all rounded-t-xl"
            style={tab === val
              ? { background: 'rgba(255,255,255,0.06)', color: '#ffffff', borderBottom: '2px solid #22c55e' }
              : { color: 'rgba(255,255,255,0.4)', borderBottom: '2px solid transparent' }}>
            {lbl}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {tab === 'orcamento' ? <Orcamento month={month} year={year} /> : <Metas />}
      </div>
    </div>
  );
}
