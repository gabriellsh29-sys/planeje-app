import React, { useState, useEffect, useRef } from 'react';
import CalculatorModal from '../components/CalculatorModal';
import { newId } from '../lib/ids';

const RECEITAS_KEY  = 'financeiro_receitas';
const CAT_KEY       = 'financeiro_categorias_receita';
const CATEGORIAS_PADRAO = ['Salário','Freelance','Aluguel recebido','Investimentos','Venda','Bônus','Outros'];
const MONTHS_LABEL  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const fmt     = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtDate = (d) => { if (!d) return '-'; return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }); };

function loadCats()    { try { const s = JSON.parse(localStorage.getItem(CAT_KEY) || 'null'); return (s && s.length) ? s : CATEGORIAS_PADRAO; } catch { return CATEGORIAS_PADRAO; } }
function loadReceitas(){ try { return JSON.parse(localStorage.getItem(RECEITAS_KEY) || '[]'); } catch { return []; } }
function saveReceitas(l){ localStorage.setItem(RECEITAS_KEY, JSON.stringify(l)); }
function saveCats(l)   { localStorage.setItem(CAT_KEY, JSON.stringify(l)); }

function parcelaAbrangeMs(r, month, year) {
  if (!r.data) return false;
  const [ry, rm] = r.data.split('-').map(Number);
  const inicio = ry * 12 + (rm - 1);
  const fim = inicio + ((r.totalParcelas || 1) - 1);
  const atual = year * 12 + (month - 1);
  return atual >= inicio && atual <= fim;
}

function parcelaValor(r) {
  if (r.recorrencia === 'parcelar' && r.totalParcelas > 1) return r.valor / r.totalParcelas;
  return r.valor;
}

function filtrar(receitas, month, year) {
  return receitas.filter(r => {
    if (r.recorrencia === 'fixa') {
      if (!r.data) return true;
      const [ry, rm] = r.data.split('-').map(Number);
      return (year * 12 + (month - 1)) >= (ry * 12 + (rm - 1));
    }
    if (r.recorrencia === 'parcelar') return parcelaAbrangeMs(r, month, year);
    const d = r.recebimentoData || r.data;
    if (!d) return false;
    const [y, m] = d.split('-').map(Number);
    return y === year && m === month;
  });
}

const emptyForm = () => ({
  nome: '', categoria: 'Salário', valor: '', data: new Date().toISOString().slice(0,10),
  recorrencia: 'nao', parcelaInicial: 1, totalParcelas: 2, periodicidade: 'Mensal',
  valorMode: 'total', observacao: '',
});

const PERIODICIDADES = ['Mensal', 'Quinzenal', 'Semanal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual'];

function Stepper({ label, value, onChange, min = 1, max = 999 }) {
  const [display, setDisplay] = useState(String(value));
  useEffect(() => { setDisplay(String(value)); }, [value]);
  const handleChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    setDisplay(raw);
    const num = parseInt(raw, 10);
    if (!isNaN(num)) onChange(Math.min(max, Math.max(min, num)));
  };
  const handleBlur = () => {
    const num = parseInt(display, 10);
    const clamped = isNaN(num) ? min : Math.min(max, Math.max(min, num));
    onChange(clamped);
    setDisplay(String(clamped));
  };
  return (
    <div className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <span className="text-white text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition text-lg"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}>−</button>
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          onBlur={handleBlur}
          className="text-white font-semibold text-base text-center rounded-lg"
          style={{ width: 48, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', padding: '4px 0', outline: 'none' }}
        />
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))}
          className="w-8 h-8 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/5 transition text-lg"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}>+</button>
      </div>
    </div>
  );
}

function ConfigurarParcelas({ parcelaInicial, totalParcelas, periodicidade, onChange, onClose }) {
  const [pi, setPi] = useState(parcelaInicial);
  const [tp, setTp] = useState(totalParcelas);
  const [per, setPer] = useState(periodicidade);
  const concluir = () => { onChange({ parcelaInicial: pi, totalParcelas: tp, periodicidade: per }); onClose(); };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60" style={{ backdropFilter: 'blur(8px)' }} />
      <div className="relative w-full max-w-sm card-premium overflow-hidden animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
          <span className="text-white font-semibold">Configurar Parcelas</span>
          <button onClick={concluir} className="btn-gold text-sm py-1.5 px-4">Concluir</button>
        </div>
        <div className="px-5 py-3">
          <Stepper label="Parcela inicial" value={pi} onChange={setPi} min={1} max={tp} />
          <Stepper label="Quantidade de parcelas" value={tp} onChange={v => { setTp(v); if (pi > v) setPi(v); }} min={2} max={360} />
          <div className="flex items-center justify-between py-3">
            <span className="text-white text-sm">Periodicidade</span>
            <select value={per} onChange={e => setPer(e.target.value)} className="input-premium w-auto [color-scheme:dark]">
              {PERIODICIDADES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

function AcoesMenu({ onEdit, onPagamentoParcial, onDuplicar, onExcluir, vencimentoAtual, openUp }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('main'); // main | duplicar | data
  const [dataCustom, setDataCustom] = useState(new Date().toISOString().split('T')[0]);
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setView('main'); } };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  const close = () => { setOpen(false); setView('main'); };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => { setOpen(o => !o); setView('main'); }}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-text-1 hover:bg-white/5 transition">
        <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4"><path d="M8 3a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM8 16a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/></svg>
      </button>
      {open && (
        <div className={`absolute right-0 z-50 rounded-xl py-1 min-w-[190px] ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'}`}
          style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 16px 40px rgba(0,0,0,0.6)' }}>
          {view === 'main' && (
            <>
              <p className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest font-bold text-text-3">Ações</p>
              <button onClick={() => { close(); onEdit(); }}
                className="w-full text-left px-3 py-2 text-[12px] text-text-2 hover:bg-white/5 transition">Editar</button>
              <button onClick={() => setView('duplicar')}
                className="w-full flex items-center justify-between px-3 py-2 text-[12px] text-text-2 hover:bg-white/5 transition">
                Duplicar
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
              </button>
              <button onClick={() => { close(); onPagamentoParcial(); }}
                className="w-full text-left px-3 py-2 text-[12px] text-text-2 hover:bg-white/5 transition">Pagamento parcial</button>
              <button onClick={() => { close(); onExcluir(); }}
                className="w-full text-left px-3 py-2 text-[12px] text-expense hover:bg-white/5 transition">Excluir</button>
            </>
          )}
          {view === 'duplicar' && (
            <>
              <button onClick={() => setView('main')}
                className="w-full flex items-center gap-1 px-3 py-2 text-[10px] text-text-3 hover:bg-white/5 transition">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                Voltar
              </button>
              <button onClick={() => { close(); onDuplicar(vencimentoAtual); }}
                className="w-full text-left px-3 py-2 text-[12px] text-text-2 hover:bg-white/5 transition">Manter data original</button>
              <button onClick={() => { close(); onDuplicar(new Date().toISOString().split('T')[0]); }}
                className="w-full text-left px-3 py-2 text-[12px] text-text-2 hover:bg-white/5 transition">Trocar para hoje</button>
              <button onClick={() => setView('data')}
                className="w-full text-left px-3 py-2 text-[12px] text-text-2 hover:bg-white/5 transition">Selecionar data...</button>
            </>
          )}
          {view === 'data' && (
            <div className="px-3 py-2">
              <input type="date" value={dataCustom} onChange={e => setDataCustom(e.target.value)}
                className="input-premium [color-scheme:dark] text-xs mb-2" />
              <button onClick={() => { close(); onDuplicar(dataCustom); }}
                className="btn-gold w-full text-center text-xs py-1.5">Duplicar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Receitas({ month, year }) {
  const now = new Date();
  const [lm, setLm] = useState(month || now.getMonth() + 1);
  const [ly, setLy] = useState(year  || now.getFullYear());

  useEffect(() => { if (month) setLm(month); }, [month]);
  useEffect(() => { if (year)  setLy(year);  }, [year]);

  const [receitas,    setReceitas]    = useState(loadReceitas);
  const [categorias,  setCategorias]  = useState(loadCats);

  useEffect(() => {
    const reload = () => {
      setReceitas(loadReceitas());
      setCategorias(prev => [...new Set([...loadCats(), ...prev])]);
    };
    window.addEventListener('planeje-sync', reload);
    return () => window.removeEventListener('planeje-sync', reload);
  }, []);
  const [showForm,    setShowForm]    = useState(false);
  const [form,        setForm]        = useState(emptyForm());
  const [editId,      setEditId]      = useState(null);
  const [filter,      setFilter]      = useState('todas');
  const [confirmId,   setConfirmId]   = useState(null);
  const [efetivId,    setEfetivId]    = useState(null);
  const [efDate,      setEfDate]      = useState('');
  const [efValor,     setEfValor]     = useState('');
  const [novaCateg,   setNovaCateg]   = useState('');
  const [showCateg,   setShowCateg]   = useState(false);
  const [search,      setSearch]      = useState('');
  const [showCalc,    setShowCalc]    = useState(false);
  const [showParcelas, setShowParcelas] = useState(false);

  const upd = (p) => setForm(f => ({ ...f, ...p }));

  const displayValor = form.valor
    ? `R$ ${(parseInt(form.valor) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : '';

  const salvar = () => {
    if (!form.nome.trim() || !form.valor) return;
    const valorBase = parseFloat(form.valor) / 100;
    const isParcelarMode = form.recorrencia === 'parcelar' && form.valorMode === 'parcela';
    const valor = isParcelarMode ? valorBase * form.totalParcelas : valorBase;
    const item = {
      id: editId || newId(),
      nome: form.nome.trim(), categoria: form.categoria, valor, data: form.data,
      recorrencia: form.recorrencia,
      parcelaInicial: form.parcelaInicial, totalParcelas: form.totalParcelas,
      periodicidade: form.periodicidade, observacao: form.observacao,
      recebida: editId ? (receitas.find(r => r.id === editId)?.recebida || false) : false,
      recebimentoData: editId ? (receitas.find(r => r.id === editId)?.recebimentoData || null) : null,
      updatedAt: new Date().toISOString(),
    };
    const updated = editId ? receitas.map(r => r.id === editId ? item : r) : [item, ...receitas];
    setReceitas(updated); saveReceitas(updated);
    setShowForm(false); setForm(emptyForm()); setEditId(null);
  };

  const openEfetivar = (id) => {
    const r = receitas.find(x => x.id === id);
    setEfDate(r?.recebimentoData || new Date().toISOString().slice(0,10));
    setEfValor(r?.valor ? r.valor.toFixed(2) : '');
    setEfetivId(id);
  };

  const confirmarEfetivar = () => {
    const updated = receitas.map(r => r.id === efetivId ? { ...r, recebida: true, recebimentoData: efDate, valorRecebido: parseFloat(efValor) || r.valor, updatedAt: new Date().toISOString() } : r);
    setReceitas(updated); saveReceitas(updated); setEfetivId(null);
  };

  const desfazer = (id) => {
    const updated = receitas.map(r => r.id === id ? { ...r, recebida: false, recebimentoData: null, updatedAt: new Date().toISOString() } : r);
    setReceitas(updated); saveReceitas(updated);
  };

  const remover = (id) => { const u = receitas.filter(r => r.id !== id); setReceitas(u); saveReceitas(u); setConfirmId(null); };

  const duplicar = (r, dataStr) => {
    const novo = {
      id: newId(),
      nome: r.nome, categoria: r.categoria, valor: r.valor, data: dataStr,
      recorrencia: 'nao', periodicidade: 'Mensal', observacao: r.observacao || '',
      recebida: false, recebimentoData: null,
      updatedAt: new Date().toISOString(),
    };
    const updated = [novo, ...receitas];
    setReceitas(updated); saveReceitas(updated);
  };
  const openEdit = (r) => {
    setForm({
      nome: r.nome, categoria: r.categoria, valor: Math.round(r.valor * 100).toString(), data: r.data || '',
      recorrencia: r.recorrencia || 'nao',
      parcelaInicial: r.parcelaInicial || 1, totalParcelas: r.totalParcelas || 2,
      periodicidade: r.periodicidade || 'Mensal', valorMode: 'total',
      observacao: r.observacao || '',
    });
    setEditId(r.id); setShowForm(true);
  };

  const addCateg = () => {
    const n = novaCateg.trim();
    if (!n || categorias.includes(n)) { setShowCateg(false); setNovaCateg(''); return; }
    const u = [...categorias, n]; setCategorias(u); saveCats(u); upd({ categoria: n });
    setNovaCateg(''); setShowCateg(false);
  };

  const periodo = filtrar(receitas, lm, ly);
  const filtered = periodo.filter(r => {
    if (filter === 'pendentes') return !r.recebida;
    if (filter === 'recebidas') return r.recebida;
    if (search.trim() && !r.nome.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const totalPendente  = periodo.filter(r => !r.recebida).reduce((s, r) => s + parcelaValor(r), 0);
  const totalRecebido  = periodo.filter(r => r.recebida).reduce((s, r) => s + (r.valorRecebido || parcelaValor(r)), 0);

  return (
    <div className="p-4 md:p-6 pb-24 md:pb-8 animate-fade-in">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-bold text-lg">Receitas</h2>
        <button onClick={() => { setForm(emptyForm()); setEditId(null); setShowForm(true); }}
          className="btn-gold flex items-center gap-1.5 py-2 px-4 text-sm">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/></svg>
          Nova
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card-premium p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-income" />
            <p className="text-white/70 text-xs">A receber</p>
          </div>
          <p className="text-income font-bold text-lg">{fmt(totalPendente)}</p>
          <p className="text-white/50 text-[10px] mt-0.5">{periodo.filter(r => !r.recebida).length} pendentes</p>
        </div>
        <div className="card-premium p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-income" />
            <p className="text-white/70 text-xs">Recebidas</p>
          </div>
          <p className="text-income font-bold text-lg">{fmt(totalRecebido)}</p>
          <p className="text-white/50 text-[10px] mt-0.5">{periodo.filter(r => r.recebida).length} confirmadas</p>
        </div>
      </div>

      {/* Busca */}
      <div className="relative mb-3">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar receita..." className="input-premium pl-9" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
        )}
      </div>

      {/* Filtro status */}
      <div className="flex gap-1 mb-3 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {[['todas','Todas'],['pendentes','A Receber'],['recebidas','Recebidas']].map(([val, lbl]) => (
          <button key={val} onClick={() => setFilter(val)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={filter === val
              ? { background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }
              : { color: 'rgba(255,255,255,0.45)', border: '1px solid transparent' }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Período */}
      <div className="flex gap-2 mb-4">
        <select value={lm} onChange={e => setLm(Number(e.target.value))}
          className="rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer [color-scheme:dark]"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {MONTHS_LABEL.map((l, i) => <option key={i+1} value={i+1}>{l}</option>)}
        </select>
        <select value={ly} onChange={e => setLy(Number(e.target.value))}
          className="rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none cursor-pointer [color-scheme:dark]"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {[ly-2,ly-1,ly,ly+1,ly+2].map(yr => <option key={yr} value={yr}>{yr}</option>)}
        </select>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-white/40">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-7 h-7"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <p className="text-sm text-white/60 font-medium">Nenhuma receita neste período</p>
          <p className="text-xs mt-1">Registre suas entradas de renda</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r, idx) => (
            <div key={r.id} className="card-premium transition-all active:scale-[0.99]">
              <div className="px-4 pt-3.5 pb-3">
                {/* Linha 1: ícone + nome + valor */}
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: r.recebida ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.08)' }}>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"
                      style={{ color: '#22c55e', transform: 'rotate(-45deg)' }}>
                      <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${r.recebida ? 'text-white/60 line-through' : 'text-white'}`}>
                      {r.nome}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-white/70">{r.categoria}</span>
                      {r.recorrencia === 'fixa' && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
                          Fixa · {r.periodicidade || 'Mensal'}
                        </span>
                      )}
                      {r.recorrencia === 'parcelar' && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
                          {r.parcelaInicial}/{r.totalParcelas}x · {r.periodicidade || 'Mensal'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-sm font-bold text-income">{fmt(parcelaValor(r))}</p>
                    {r.recebida && r.valorRecebido && r.valorRecebido !== parcelaValor(r) && (
                      <p className="text-[10px] text-white/50">recebido {fmt(r.valorRecebido)}</p>
                    )}
                  </div>
                </div>

                {/* Data */}
                {r.data && (
                  <div className="flex items-center gap-1.5 mt-2 ml-12">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 text-white/35">
                      <path d="M3.5 0a.5.5 0 01.5.5V1h8V.5a.5.5 0 011 0V1h1a2 2 0 012 2v11a2 2 0 01-2 2H2a2 2 0 01-2-2V3a2 2 0 012-2h1V.5a.5.5 0 01.5-.5zM1 4v10a1 1 0 001 1h12a1 1 0 001-1V4H1z"/>
                    </svg>
                    <span className="text-[11px] text-white/70">
                      {r.recorrencia === 'fixa' ? `Desde ${fmtDate(r.data)}` : fmtDate(r.data)}
                    </span>
                    {r.recebida && r.recebimentoData && (
                      <span className="text-[11px] text-income ml-1">· Recebido {fmtDate(r.recebimentoData)}</span>
                    )}
                  </div>
                )}

                {/* Ações */}
                <div className="flex items-center justify-between mt-3 ml-12" onClick={e => e.stopPropagation()}>
                  <div>
                    {!r.recebida ? (
                      <button onClick={() => openEfetivar(r.id)}
                        className="text-xs font-semibold px-3 py-1 rounded-lg transition-all"
                        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
                        Confirmar recebimento
                      </button>
                    ) : (
                      <button onClick={() => desfazer(r.id)}
                        className="text-xs text-white/40 hover:text-white/70 transition">
                        ↩ Desfazer
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {confirmId === r.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-text-3 text-[11px]">Excluir?</span>
                        <button onClick={() => remover(r.id)} className="text-expense text-xs font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)' }}>✓</button>
                        <button onClick={() => setConfirmId(null)} className="text-white/40 text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>✕</button>
                      </div>
                    ) : (
                      <AcoesMenu
                        onEdit={() => openEdit(r)}
                        onPagamentoParcial={() => openEfetivar(r.id)}
                        onDuplicar={(dataStr) => duplicar(r, dataStr)}
                        onExcluir={() => setConfirmId(r.id)}
                        vencimentoAtual={r.data}
                        openUp={idx >= filtered.length - 2}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal formulário */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative w-full max-w-md rounded-[1.5rem] shadow-2xl overflow-x-hidden overflow-y-auto"
            style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '92vh' }}
            onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between px-5 py-4 z-10"
              style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setShowForm(false)} className="w-11 h-11 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
              </button>
              <h3 className="text-white font-semibold">{editId ? 'Editar Receita' : 'Nova Receita'}</h3>
              <button onClick={salvar} disabled={!form.nome.trim() || !form.valor}
                className="btn-gold py-1.5 px-4 text-sm disabled:opacity-40">Salvar</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-white/50 text-xs font-medium block mb-1.5">Descrição</label>
                <input value={form.nome} onChange={e => upd({ nome: e.target.value })}
                  placeholder="Ex: Salário, Freelance..." className="input-premium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/50 text-xs font-medium block mb-1.5">Valor</label>
                  <div className="relative">
                    <input type="text" inputMode="numeric" value={displayValor}
                      onChange={e => upd({ valor: e.target.value.replace(/\D/g,'') })}
                      placeholder="R$ 0,00" className="input-premium pr-9" />
                    <button type="button" onClick={() => setShowCalc(true)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3 hover:text-accent transition">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2H5zm0 2h10v3H5V4zm0 5h2v2H5V9zm3 0h2v2H8V9zm3 0h2v2h-2V9zm-6 4h2v2H5v-2zm3 0h2v2H8v-2zm3 0h2v4h-2v-4z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-white/50 text-xs font-medium block mb-1.5">Data</label>
                  <input type="date" value={form.data} onChange={e => upd({ data: e.target.value })}
                    className="input-premium [color-scheme:dark]" />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-white/50 text-xs font-medium">Categoria</label>
                  <button type="button" onClick={() => setShowCateg(v => !v)}
                    className="text-gold text-xs hover:opacity-80 transition">+ Nova</button>
                </div>
                {showCateg && (
                  <div className="flex gap-2 mb-2">
                    <input autoFocus value={novaCateg} onChange={e => setNovaCateg(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addCateg(); if (e.key === 'Escape') setShowCateg(false); }}
                      placeholder="Nome..." className="input-premium flex-1" />
                    <button type="button" onClick={addCateg} className="btn-gold py-2 px-3 text-sm">OK</button>
                  </div>
                )}
                <select value={form.categoria} onChange={e => upd({ categoria: e.target.value })}
                  className="input-premium [color-scheme:dark]">
                  {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <p className="text-white/40 text-[10px] font-semibold uppercase tracking-widest">Recorrência</p>
                </div>
                {[
                  { val: 'nao',      label: 'Não recorrente',      desc: 'Entrada única, pontual' },
                  { val: 'parcelar', label: 'Parcelar ou repetir', desc: 'Define parcelas e periodicidade' },
                  { val: 'fixa',     label: 'Fixa mensal',         desc: 'Repete todo mês (ex: salário)' },
                ].map((opt, i, arr) => (
                  <div key={opt.val} style={{ borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/2 transition">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${form.recorrencia === opt.val ? 'border-2 border-income' : 'border border-white/30'}`}>
                        {form.recorrencia === opt.val && <div className="w-2 h-2 rounded-full bg-income" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-white text-sm">{opt.label}</p>
                        <p className="text-white/40 text-[10px]">{opt.desc}</p>
                      </div>
                      <input type="radio" className="hidden" checked={form.recorrencia === opt.val} onChange={() => upd({ recorrencia: opt.val })} />
                    </label>
                    {opt.val === 'parcelar' && form.recorrencia === 'parcelar' && (
                      <>
                        <button type="button" onClick={() => setShowParcelas(true)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/3 transition"
                          style={{ background: 'rgba(34,197,94,0.04)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          <div className="flex items-center gap-2">
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-income"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
                            <span className="text-white text-sm">Parcela {form.parcelaInicial}/{form.totalParcelas} · {form.periodicidade}</span>
                          </div>
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white/40"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
                        </button>
                        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.15)' }}>
                          <p className="text-white/40 text-[10px] font-semibold uppercase tracking-widest mb-2">O valor informado é</p>
                          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(34,197,94,0.2)' }}>
                            {[['total','Valor total','O total será dividido pelas parcelas'],['parcela','Valor parcela','Cada parcela terá esse valor fixo']].map(([mode, label]) => (
                              <button key={mode} type="button"
                                onClick={() => upd({ valorMode: mode })}
                                className="flex-1 py-2.5 px-2 text-xs font-semibold transition-all text-center"
                                style={form.valorMode === mode ? {
                                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                  color: '#0f172a',
                                } : { color: 'rgba(255,255,255,0.45)', background: 'transparent' }}>
                                {label}
                              </button>
                            ))}
                          </div>
                          <p className="text-white/40 text-[10px] mt-1.5">
                            {form.valorMode === 'total'
                              ? `Cada parcela = valor ÷ ${form.totalParcelas}`
                              : `Total = valor × ${form.totalParcelas}`}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <label className="text-white/50 text-xs font-medium block mb-1.5">Observação</label>
                <input value={form.observacao} onChange={e => upd({ observacao: e.target.value })}
                  placeholder="Opcional..." className="input-premium" />
              </div>
              <button
                onClick={salvar}
                disabled={!form.nome.trim() || !form.valor}
                className="btn-gold w-full text-center disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Parcelas modal */}
      {showParcelas && (
        <ConfigurarParcelas
          parcelaInicial={form.parcelaInicial} totalParcelas={form.totalParcelas} periodicidade={form.periodicidade}
          onChange={({ parcelaInicial, totalParcelas, periodicidade }) => upd({ parcelaInicial, totalParcelas, periodicidade })}
          onClose={() => setShowParcelas(false)}
        />
      )}

      {/* Modal confirmar recebimento */}
      {efetivId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative card-premium p-6 w-full max-w-xs animate-scale-in" onClick={e => e.stopPropagation()}>
            <h3 className="text-white font-semibold mb-1">Confirmar recebimento</h3>
            <p className="text-white/40 text-xs mb-4">Informe a data e o valor recebido</p>
            <div className="mb-3">
              <label className="text-white/50 text-xs block mb-1.5">Data do recebimento</label>
              <input type="date" value={efDate} onChange={e => setEfDate(e.target.value)}
                className="input-premium [color-scheme:dark]" />
            </div>
            <div className="mb-4">
              <label className="text-white/50 text-xs block mb-1.5">Valor recebido (R$)</label>
              <input type="number" step="0.01" value={efValor} onChange={e => setEfValor(e.target.value)}
                className="input-premium" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEfetivId(null)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={confirmarEfetivar} className="btn-gold flex-1 text-center">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {showCalc && (
        <CalculatorModal
          initialValue={form.valor ? parseInt(form.valor) / 100 : 0}
          onClose={() => setShowCalc(false)}
          onConfirm={(val) => { upd({ valor: Math.round(val * 100).toString() }); setShowCalc(false); }}
        />
      )}
    </div>
  );
}
