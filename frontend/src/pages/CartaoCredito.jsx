import React, { useState, useMemo } from 'react';
import CalculatorModal from '../components/CalculatorModal';

const CARTAO_KEY  = 'planeje_cartoes';
const FATURA_KEY  = 'planeje_faturas';

const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const fmtDate = (d) => { try { return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return d || ''; } };

const BANDEIRAS = ['Visa','Mastercard','Elo','Hipercard','American Express','Outra'];
const CORES_CARTAO = ['#1a1a2e','#16213e','#0f3460','#533483','#6b2d8b','#1b4332','#7f1d1d','#1e3a5f'];

function load(key, fb) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fb; } catch { return fb; } }
function save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

function getDiasParaFechamento(diaFechamento) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const fech = new Date(hoje); fech.setDate(diaFechamento);
  if (fech < hoje) fech.setMonth(fech.getMonth() + 1);
  return Math.ceil((fech - hoje) / 86400000);
}
function getDiasParaPagamento(diaPagamento) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const pag  = new Date(hoje); pag.setDate(diaPagamento);
  if (pag < hoje) pag.setMonth(pag.getMonth() + 1);
  return Math.ceil((pag - hoje) / 86400000);
}

// ── Lançamento de fatura ─────────────────────────────────────────────────────
function getLancamentos(cartaoId, month, year) {
  try {
    const all = JSON.parse(localStorage.getItem(FATURA_KEY) || '[]');
    return all.filter(l => l.cartaoId === cartaoId && l.mes === month && l.ano === year);
  } catch { return []; }
}
function addLancamento(item) {
  const all = load(FATURA_KEY, []);
  all.push(item); save(FATURA_KEY, all);
}
function removeLancamento(id) {
  const all = load(FATURA_KEY, []).filter(l => l.id !== id); save(FATURA_KEY, all);
}

const CATEGORIAS_FATURA = ['Alimentação','Transporte','Saúde','Lazer','Compras','Educação','Viagem','Streaming','Outros'];

export default function CartaoCredito({ month, year }) {
  const [cartoes,    setCartoes]    = useState(() => load(CARTAO_KEY, []));
  const [cartaoAtivo, setCartaoAtivo] = useState(null);
  const [showFormCartao, setShowFormCartao] = useState(false);
  const [editCartaoId,   setEditCartaoId]   = useState(null);
  const [showFormLanc,   setShowFormLanc]   = useState(false);
  const [showPagar,      setShowPagar]      = useState(false);

  const [formC, setFormC] = useState({ nome: '', bandeira: 'Visa', limite: '', diaFechamento: '1', diaPagamento: '10', cor: CORES_CARTAO[0] });
  const [formL, setFormL] = useState({ descricao: '', valor: '', categoria: 'Outros', parcelas: '1', data: new Date().toISOString().slice(0, 10) });
  const [search, setSearch] = useState('');
  const [showCalc, setShowCalc] = useState(false);

  const updC = p => setFormC(f => ({ ...f, ...p }));
  const updL = p => setFormL(f => ({ ...f, ...p }));

  const cartaoSelecionado = cartoes.find(c => c.id === cartaoAtivo) || cartoes[0] || null;
  const lancamentos = useMemo(() =>
    cartaoSelecionado ? getLancamentos(cartaoSelecionado.id, month, year) : [],
    [cartaoSelecionado?.id, month, year, showFormLanc, showPagar]);

  const totalFatura = lancamentos.reduce((s, l) => s + (l.valor / (l.parcelas || 1)), 0);
  const lancamentosFiltrados = useMemo(() =>
    search.trim() ? lancamentos.filter(l => l.descricao.toLowerCase().includes(search.trim().toLowerCase())) : lancamentos,
    [lancamentos, search]);
  const faturaPaga  = cartaoSelecionado?.faturasPagas?.[`${year}-${month}`] || false;

  const salvarCartao = () => {
    if (!formC.nome.trim() || !formC.limite) return;
    const item = {
      id: editCartaoId || Date.now().toString(),
      nome: formC.nome.trim(), bandeira: formC.bandeira,
      limite: parseFloat(formC.limite.replace(',','.')) || 0,
      diaFechamento: parseInt(formC.diaFechamento) || 1,
      diaPagamento: parseInt(formC.diaPagamento) || 10,
      cor: formC.cor, faturasPagas: editCartaoId ? (cartoes.find(c=>c.id===editCartaoId)?.faturasPagas || {}) : {},
    };
    const updated = editCartaoId ? cartoes.map(c => c.id === editCartaoId ? item : c) : [...cartoes, item];
    setCartoes(updated); save(CARTAO_KEY, updated);
    setShowFormCartao(false); setEditCartaoId(null);
    setFormC({ nome: '', bandeira: 'Visa', limite: '', diaFechamento: '1', diaPagamento: '10', cor: CORES_CARTAO[0] });
    if (!cartaoAtivo && updated.length === 1) setCartaoAtivo(updated[0].id);
  };

  const removerCartao = (id) => {
    const updated = cartoes.filter(c => c.id !== id); setCartoes(updated); save(CARTAO_KEY, updated);
    if (cartaoAtivo === id) setCartaoAtivo(updated[0]?.id || null);
  };

  const openEditCartao = (c) => {
    setFormC({ nome: c.nome, bandeira: c.bandeira, limite: c.limite.toFixed(2), diaFechamento: String(c.diaFechamento), diaPagamento: String(c.diaPagamento), cor: c.cor || CORES_CARTAO[0] });
    setEditCartaoId(c.id); setShowFormCartao(true);
  };

  const salvarLancamento = () => {
    if (!formL.descricao.trim() || !formL.valor || !cartaoSelecionado) return;
    const valor = parseFloat(formL.valor.replace(',','.')) || 0;
    const parcelas = parseInt(formL.parcelas) || 1;
    for (let p = 0; p < parcelas; p++) {
      const d = new Date(formL.data + 'T00:00:00');
      d.setMonth(d.getMonth() + p);
      addLancamento({
        id: `${Date.now()}_${p}`,
        cartaoId: cartaoSelecionado.id,
        descricao: `${formL.descricao.trim()}${parcelas > 1 ? ` (${p+1}/${parcelas})` : ''}`,
        valor, categoria: formL.categoria, parcelas,
        parcelaAtual: p + 1,
        mes: d.getMonth() + 1, ano: d.getFullYear(),
        data: formL.data,
      });
    }
    setShowFormLanc(false);
    setFormL({ descricao: '', valor: '', categoria: 'Outros', parcelas: '1', data: new Date().toISOString().slice(0, 10) });
  };

  const marcarFaturaPaga = () => {
    if (!cartaoSelecionado) return;
    const key = `${year}-${month}`;
    const updated = cartoes.map(c => c.id === cartaoSelecionado.id
      ? { ...c, faturasPagas: { ...(c.faturasPagas || {}), [key]: !faturaPaga } }
      : c);
    setCartoes(updated); save(CARTAO_KEY, updated); setShowPagar(false);
  };

  const limiteUsado = cartaoSelecionado ? (cartaoSelecionado.limite > 0 ? totalFatura / cartaoSelecionado.limite * 100 : 0) : 0;
  const diasFech    = cartaoSelecionado ? getDiasParaFechamento(cartaoSelecionado.diaFechamento) : null;
  const diasPag     = cartaoSelecionado ? getDiasParaPagamento(cartaoSelecionado.diaPagamento) : null;

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Seletor de cartões - scroll horizontal */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 overflow-x-auto"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex gap-3 min-w-max">
          {cartoes.map(c => (
            <button key={c.id} onClick={() => setCartaoAtivo(c.id)}
              className="flex-shrink-0 flex flex-col w-36 p-3 rounded-2xl transition-all text-left"
              style={{
                background: cartaoAtivo === c.id || (!cartaoAtivo && cartaoSelecionado?.id === c.id) ? c.cor : 'rgba(255,255,255,0.04)',
                border: `1px solid ${cartaoAtivo === c.id || (!cartaoAtivo && cartaoSelecionado?.id === c.id) ? c.cor : 'rgba(255,255,255,0.08)'}`,
                transform: cartaoAtivo === c.id ? 'scale(1.02)' : 'scale(1)',
              }}>
              <p className="text-white text-xs font-bold truncate">{c.nome}</p>
              <p className="text-white/60 text-[10px]">{c.bandeira}</p>
              <p className="text-white text-sm font-bold mt-2">{fmt(c.limite - totalFatura)}</p>
              <p className="text-white/50 text-[9px]">disponível</p>
            </button>
          ))}
          <button onClick={() => { setShowFormCartao(true); setEditCartaoId(null); setFormC({ nome: '', bandeira: 'Visa', limite: '', diaFechamento: '1', diaPagamento: '10', cor: CORES_CARTAO[0] }); }}
            className="flex-shrink-0 w-36 p-3 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.15)' }}>
            <span className="text-2xl text-white/30">+</span>
            <span className="text-white/40 text-[10px]">Novo cartão</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-8 space-y-4">
        {!cartaoSelecionado ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/40">
            <span className="text-5xl mb-4 opacity-30">💳</span>
            <p className="text-sm text-white/60 font-medium">Nenhum cartão cadastrado</p>
            <p className="text-xs mt-1">Adicione seu cartão de crédito</p>
          </div>
        ) : (
          <>
            {/* Painel do cartão */}
            <div className="rounded-2xl p-5 relative overflow-hidden"
              style={{ background: `linear-gradient(135deg, ${cartaoSelecionado.cor} 0%, ${cartaoSelecionado.cor}cc 100%)`, minHeight: 160 }}>
              <div className="absolute top-0 right-0 w-48 h-32 pointer-events-none opacity-10"
                style={{ background: 'radial-gradient(ellipse, white 0%, transparent 70%)' }} />
              <div className="flex items-start justify-between mb-6">
                <div>
                  <p className="text-white/60 text-[10px] font-semibold uppercase tracking-widest">Fatura {month}/{year}</p>
                  <p className="text-white font-bold text-3xl mt-1">{fmt(totalFatura)}</p>
                  {faturaPaga && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block" style={{ background: 'rgba(34,197,94,0.3)', color: '#86efac' }}>✓ Paga</span>}
                </div>
                <div className="flex gap-1.5">
                  <button onClick={() => openEditCartao(cartaoSelecionado)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition flex items-center justify-center">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-white"><path d="M12.854.146a.5.5 0 00-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 000-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 016 13.5V13h-.5a.5.5 0 01-.5-.5V12h-.5a.5.5 0 01-.5-.5V11h-.5a.5.5 0 01-.5-.5V10h-.5a.499.499 0 01-.175-.032l-.179.178a.5.5 0 00-.11.168l-2 5a.5.5 0 00.65.65l5-2a.5.5 0 00.168-.11l.178-.178z"/></svg>
                  </button>
                  <button onClick={() => removerCartao(cartaoSelecionado.id)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-red-400/30 transition flex items-center justify-center">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-white"><path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" clipRule="evenodd"/></svg>
                  </button>
                </div>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-white font-bold text-lg">{cartaoSelecionado.nome}</p>
                  <p className="text-white/60 text-xs">{cartaoSelecionado.bandeira} · Limite {fmt(cartaoSelecionado.limite)}</p>
                </div>
                <div className="text-right">
                  <p className="text-white/60 text-[10px]">Fecha dia {cartaoSelecionado.diaFechamento} · Paga dia {cartaoSelecionado.diaPagamento}</p>
                </div>
              </div>
              {/* Barra de limite */}
              <div className="mt-3">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.15)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${Math.min(100, limiteUsado)}%`, background: limiteUsado >= 90 ? '#f43f5e' : limiteUsado >= 70 ? '#f59e0b' : 'rgba(255,255,255,0.8)' }} />
                </div>
                <p className="text-white/50 text-[9px] mt-1">{Math.round(limiteUsado)}% do limite utilizado</p>
              </div>
            </div>

            {/* Chips de info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="card-premium p-3 text-center">
                <p className="text-white/50 text-[10px]">Fecha em</p>
                <p className="text-white font-bold text-lg">{diasFech === 0 ? 'Hoje' : `${diasFech}d`}</p>
                <p className="text-white/40 text-[9px]">dia {cartaoSelecionado.diaFechamento} de cada mês</p>
              </div>
              <div className="card-premium p-3 text-center">
                <p className="text-white/50 text-[10px]">Vence em</p>
                <p className="font-bold text-lg" style={{ color: diasPag <= 5 ? '#f43f5e' : '#ffffff' }}>
                  {diasPag === 0 ? 'Hoje' : `${diasPag}d`}
                </p>
                <p className="text-white/40 text-[9px]">dia {cartaoSelecionado.diaPagamento} de cada mês</p>
              </div>
            </div>

            {/* Ações */}
            <div className="flex gap-3">
              <button onClick={() => setShowFormLanc(true)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                style={{ background: 'rgba(201,168,76,0.1)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.2)' }}>
                + Lançamento
              </button>
              <button onClick={() => setShowPagar(true)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                style={{ background: faturaPaga ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)', color: faturaPaga ? '#22c55e' : '#fff', border: `1px solid ${faturaPaga ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.1)'}` }}>
                {faturaPaga ? '✓ Paga' : 'Pagar fatura'}
              </button>
            </div>

            {/* Lista de lançamentos */}
            <div>
              <p className="text-white/60 text-xs font-semibold uppercase tracking-widest mb-3">
                Lançamentos · {lancamentosFiltrados.length} item{lancamentosFiltrados.length !== 1 ? 's' : ''}
              </p>
              {lancamentos.length > 0 && (
                <div className="relative mb-3">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none">
                    <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd"/>
                  </svg>
                  <input value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar lançamento..." className="input-premium pl-9" />
                  {search && (
                    <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                    </button>
                  )}
                </div>
              )}
              {lancamentosFiltrados.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-white/30">
                  <span className="text-3xl mb-2 opacity-40">🧾</span>
                  <p className="text-sm">{lancamentos.length === 0 ? 'Nenhum lançamento neste mês' : 'Nenhum resultado encontrado'}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lancamentosFiltrados.map(l => (
                    <div key={l.id} className="card-premium px-4 py-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: 'rgba(244,63,94,0.12)' }}>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" style={{ color: '#f43f5e', transform: 'rotate(45deg)' }}>
                          <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-semibold truncate">{l.descricao}</p>
                        <p className="text-white/50 text-[10px]">{l.categoria} · {fmtDate(l.data)}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-white font-bold text-sm">{fmt(l.valor / (l.parcelas || 1))}</span>
                        <button onClick={() => removeLancamento(l.id)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-expense hover:bg-white/5 transition">
                          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" clipRule="evenodd"/></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Modal: Novo/Editar Cartão ── */}
      {showFormCartao && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative w-full max-w-sm rounded-t-[1.75rem] md:rounded-[1.5rem] overflow-hidden"
            style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div className="md:hidden flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} /></div>
            <div className="sticky top-0 flex items-center justify-between px-5 py-4 z-10"
              style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setShowFormCartao(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white">×</button>
              <h3 className="text-white font-semibold">{editCartaoId ? 'Editar Cartão' : 'Novo Cartão'}</h3>
              <button onClick={salvarCartao} className="btn-gold py-1.5 px-4 text-sm">Salvar</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              {/* Preview do cartão */}
              <div className="rounded-2xl p-4 h-24 flex flex-col justify-between transition-all"
                style={{ background: `linear-gradient(135deg, ${formC.cor}, ${formC.cor}cc)` }}>
                <p className="text-white font-bold">{formC.nome || 'Nome do cartão'}</p>
                <p className="text-white/60 text-xs">{formC.bandeira} · Limite {fmt(parseFloat(formC.limite.replace(',','.')) || 0)}</p>
              </div>
              {/* Cores */}
              <div className="flex gap-2 flex-wrap">
                {CORES_CARTAO.map(c => (
                  <button key={c} onClick={() => updC({ cor: c })}
                    className="w-7 h-7 rounded-full transition-transform flex items-center justify-center"
                    style={{ background: c, transform: formC.cor === c ? 'scale(1.25)' : 'scale(1)', border: formC.cor === c ? '2px solid white' : '2px solid transparent' }}>
                    {formC.cor === c && <span className="text-white text-[8px]">✓</span>}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Nome do cartão</label>
                <input value={formC.nome} onChange={e => updC({ nome: e.target.value })} placeholder="Ex: Nubank, Inter, Bradesco..." className="input-premium" />
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Bandeira</label>
                <select value={formC.bandeira} onChange={e => updC({ bandeira: e.target.value })} className="input-premium [color-scheme:dark]">
                  {BANDEIRAS.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Limite (R$)</label>
                <input type="number" step="0.01" value={formC.limite} onChange={e => updC({ limite: e.target.value })} placeholder="0,00" className="input-premium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/50 text-xs block mb-1.5">Dia fechamento</label>
                  <select value={formC.diaFechamento} onChange={e => updC({ diaFechamento: e.target.value })} className="input-premium [color-scheme:dark]">
                    {Array.from({length:28},(_,i)=>i+1).map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-white/50 text-xs block mb-1.5">Dia pagamento</label>
                  <select value={formC.diaPagamento} onChange={e => updC({ diaPagamento: e.target.value })} className="input-premium [color-scheme:dark]">
                    {Array.from({length:28},(_,i)=>i+1).map(d=><option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="pb-2" />
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Novo Lançamento ── */}
      {showFormLanc && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative w-full max-w-sm rounded-t-[1.75rem] md:rounded-[1.5rem] overflow-hidden"
            style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={e => e.stopPropagation()}>
            <div className="md:hidden flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} /></div>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setShowFormLanc(false)} className="text-white/40">×</button>
              <h3 className="text-white font-semibold">Novo Lançamento</h3>
              <button onClick={salvarLancamento} className="btn-gold py-1.5 px-4 text-sm">Salvar</button>
            </div>
            <div className="px-5 py-4 space-y-4 pb-6">
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Descrição</label>
                <input value={formL.descricao} onChange={e => updL({ descricao: e.target.value })} placeholder="Ex: Supermercado, Uber, Netflix..." className="input-premium" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-white/50 text-xs block mb-1.5">Valor (R$)</label>
                  <div className="relative">
                    <input type="number" step="0.01" value={formL.valor} onChange={e => updL({ valor: e.target.value })} placeholder="0,00" className="input-premium pr-9" />
                    <button type="button" onClick={() => setShowCalc(true)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3 hover:text-accent transition">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2H5zm0 2h10v3H5V4zm0 5h2v2H5V9zm3 0h2v2H8V9zm3 0h2v2h-2V9zm-6 4h2v2H5v-2zm3 0h2v2H8v-2zm3 0h2v4h-2v-4z" clipRule="evenodd"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-white/50 text-xs block mb-1.5">Parcelas</label>
                  <select value={formL.parcelas} onChange={e => updL({ parcelas: e.target.value })} className="input-premium [color-scheme:dark]">
                    {[1,2,3,4,5,6,7,8,9,10,11,12,18,24].map(p=><option key={p} value={p}>{p === 1 ? 'À vista' : `${p}x`}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Categoria</label>
                <select value={formL.categoria} onChange={e => updL({ categoria: e.target.value })} className="input-premium [color-scheme:dark]">
                  {CATEGORIAS_FATURA.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-white/50 text-xs block mb-1.5">Data da compra</label>
                <input type="date" value={formL.data} onChange={e => updL({ data: e.target.value })} className="input-premium [color-scheme:dark]" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Confirmar pagamento fatura ── */}
      {showPagar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(10px)' }} />
          <div className="relative card-premium p-6 w-full max-w-xs animate-scale-in" onClick={e => e.stopPropagation()}>
            <p className="text-white font-semibold text-center mb-1">
              {faturaPaga ? 'Desmarcar pagamento?' : 'Confirmar pagamento?'}
            </p>
            <p className="text-white/50 text-xs text-center mb-5">
              Fatura de {fmt(totalFatura)} — {['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][month-1]}/{year}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowPagar(false)} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={marcarFaturaPaga} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{ background: faturaPaga ? 'rgba(244,63,94,0.15)' : 'rgba(34,197,94,0.15)', color: faturaPaga ? '#f43f5e' : '#22c55e', border: `1px solid ${faturaPaga ? 'rgba(244,63,94,0.3)' : 'rgba(34,197,94,0.3)'}` }}>
                {faturaPaga ? 'Desmarcar' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCalc && (
        <CalculatorModal
          initialValue={parseFloat(formL.valor) || 0}
          onClose={() => setShowCalc(false)}
          onConfirm={(val) => { updL({ valor: val.toFixed(2) }); setShowCalc(false); }}
        />
      )}
    </div>
  );
}
