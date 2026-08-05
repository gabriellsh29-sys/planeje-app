import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import CalculatorModal from '../components/CalculatorModal';
import SelectDown from '../components/SelectDown';
import { newId } from '../lib/ids';
import { useLockBodyScroll } from '../lib/useLockBodyScroll';

const fmt = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
const fmtDate = (d) => {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const DIVIDA_KEY = 'financeiro_dividas';
const CAT_KEY = 'financeiro_categorias_divida';
const CATEGORIAS_PADRAO = ['Alimentação','Moradia','Transporte','Saúde','Educação','Lazer','Vestuário','Cartão de Crédito','Empréstimo','Financiamento','Conta/Serviço','Impostos','Família','Outros'];
const PERIODICIDADES = ['Mensal','Quinzenal','Semanal','Bimestral','Trimestral','Semestral','Anual'];

function loadCategorias() { try { const s = JSON.parse(localStorage.getItem(CAT_KEY) || 'null'); return (s && s.length) ? s : CATEGORIAS_PADRAO; } catch { return CATEGORIAS_PADRAO; } }
function saveCategorias(list) { localStorage.setItem(CAT_KEY, JSON.stringify(list)); }
function loadDividas() {
  try {
    const data = JSON.parse(localStorage.getItem(DIVIDA_KEY) || '[]');
    const merged = data.map(d => ({ ...d, categoria: d.categoria === 'Viagens' ? 'Viagem' : d.categoria }));
    if (merged.some((d, i) => d.categoria !== data[i].categoria)) saveDividas(merged);
    return merged;
  } catch { return []; }
}
function saveDividas(list) { localStorage.setItem(DIVIDA_KEY, JSON.stringify(list)); }

function parcelaAbrangeMs(d, month, year) {
  const dateStr = d.vencimento;
  if (!dateStr) return false;
  const [vy, vm] = dateStr.split('-').map(Number);
  const inicio = vy * 12 + (vm - 1);
  const fim = inicio + ((d.totalParcelas || 1) - 1);
  const atual = year * 12 + (month - 1);
  return atual >= inicio && atual <= fim;
}

function filtrarPeriodo(dividas, month, year) {
  return dividas.filter(d => {
    if (d.recorrencia === 'fixa') {
      // Só aparece a partir do mês de cadastro (vencimento)
      if (!d.vencimento) return true;
      const [vy, vm] = d.vencimento.split('-').map(Number);
      const inicio = vy * 12 + (vm - 1);
      const atual = year * 12 + (month - 1);
      return atual >= inicio;
    }
    if (d.recorrencia === 'parcelar') return parcelaAbrangeMs(d, month, year);
    const dateStr = d.pagamentoData || d.vencimento;
    if (!dateStr) return false;
    const [y, m] = dateStr.split('-').map(Number);
    return y === year && m === month;
  });
}

// Retorna o valor da parcela (total ÷ qtd) se parcelada, senão o valor cheio
function parcelaValor(d) {
  if (d.recorrencia === 'parcelar' && d.totalParcelas > 1) {
    return d.valor / d.totalParcelas;
  }
  return d.valor;
}

// Para itens "fixa", o pagamento é controlado por mês (mapa d.pagamentos['YYYY-MM']),
// para que quitar Abril não afete Maio, Junho etc. Itens "nao"/"parcelar" continuam
// usando os campos globais pago/pagamentoData/valorPago.
function mesKey(month, year) { return `${year}-${String(month).padStart(2, '0')}`; }

function statusMes(d, month, year) {
  if (d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') {
    const p = d.pagamentos && d.pagamentos[mesKey(month, year)];
    if (p) return { pago: !!p.pago, pagamentoData: p.pagamentoData || null, valorPago: p.valorPago ?? null };
    // Migração: dado antigo de "parcelar" guardava pago/pagamentoData num campo global
    // (bug que fazia pagar 1 parcela marcar todas como pagas). Se essa data cair no
    // mês consultado, respeita como já pago; senão, mantém pendente.
    if (d.recorrencia === 'parcelar' && d.pago && d.pagamentoData) {
      const [py, pm] = d.pagamentoData.split('-').map(Number);
      if (py === year && pm === month) return { pago: true, pagamentoData: d.pagamentoData, valorPago: d.valorPago ?? null };
    }
    return { pago: false, pagamentoData: null, valorPago: null };
  }
  return { pago: !!d.pago, pagamentoData: d.pagamentoData || null, valorPago: d.valorPago ?? null };
}

function aplicarStatusMes(d, month, year, status) {
  const stamp = new Date().toISOString();
  if (d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') {
    return { ...d, pagamentos: { ...(d.pagamentos || {}), [mesKey(month, year)]: status }, updatedAt: stamp };
  }
  return { ...d, ...status, updatedAt: stamp };
}

// Retorna a chave 'YYYY-MM' do mês anterior à chave informada
function mesKeyAnterior(key) {
  const [yy, mm] = key.split('-').map(Number);
  const date = new Date(yy, mm - 2, 1);
  return mesKey(date.getMonth() + 1, date.getFullYear());
}

// Para itens "fixa"/"parcelar", nome/valor/categoria/vencimento(dia)/observação podem
// variar por mês: d.overrides['YYYY-MM'] (somente aquele mês) ou d.historico
// (snapshots de períodos anteriores a uma alteração "deste mês em diante").
function getCamposMes(d, month, year) {
  const base = {
    nome: d.nome, valor: d.valor, categoria: d.categoria, observacao: d.observacao,
    vencimentoDia: d.vencimento ? d.vencimento.split('-')[2] : null,
  };
  if (d.recorrencia !== 'fixa' && d.recorrencia !== 'parcelar') return base;
  const key = mesKey(month, year);
  if (d.overrides && d.overrides[key]) return { ...base, ...d.overrides[key] };
  if (d.historico && d.historico.length) {
    const found = d.historico.find(h => key <= h.ate);
    if (found) return { ...base, ...found };
  }
  return base;
}

// Valor da parcela/mês considerando overrides/histórico
function parcelaValorMes(d, month, year) {
  const campos = getCamposMes(d, month, year);
  if (d.recorrencia === 'parcelar' && d.totalParcelas > 1) return campos.valor / d.totalParcelas;
  return campos.valor;
}

// Lista de "pago NESTE mês" por fluxo de caixa real — não por vencimento. Uma conta
// que venceu em julho mas só foi paga em agosto some das Pagas de julho e aparece
// nas de agosto (o vencimento original continua July se você olhar por Vencimento
// ou na aba Todas; só a aba Pagas reclassifica pelo mês em que o dinheiro saiu).
// Cada linha mantém _m/_y = mês/ano da OCORRÊNCIA original (não o mês navegado),
// pois é essa chave que localiza o registro de pagamento (d.pagamentos[key]).
function loadPagasNoMes(dividas, month, year) {
  const out = [];
  dividas.forEach(d => {
    if (d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') {
      let temEntradaModerna = false;
      if (d.pagamentos) {
        Object.entries(d.pagamentos).forEach(([key, p]) => {
          if (!p || !p.pago || !p.pagamentoData) return;
          temEntradaModerna = true;
          const [py, pm] = p.pagamentoData.split('-').map(Number);
          if (py === year && pm === month) {
            const [ky, km] = key.split('-').map(Number);
            out.push({ ...d, _m: km, _y: ky });
          }
        });
      }
      // Migração: parcelar antigo sem entrada própria em pagamentos ainda guarda
      // pago/pagamentoData num campo global (ver statusMes) — mesma regra aqui.
      if (d.recorrencia === 'parcelar' && !temEntradaModerna && d.pago && d.pagamentoData) {
        const [py, pm] = d.pagamentoData.split('-').map(Number);
        if (py === year && pm === month) {
          const [vy, vm] = (d.vencimento || d.pagamentoData).split('-').map(Number);
          out.push({ ...d, _m: vm, _y: vy });
        }
      }
    } else if (d.pago && d.pagamentoData) {
      const [py, pm] = d.pagamentoData.split('-').map(Number);
      if (py === year && pm === month) {
        const [vy, vm] = (d.vencimento || d.pagamentoData).split('-').map(Number);
        out.push({ ...d, _m: vm, _y: vy });
      }
    }
  });
  return out;
}

const emptyForm = () => ({
  nome: '', categoria: 'Cartão de Crédito', valor: '', vencimento: '',
  recorrencia: 'nao', parcelaInicial: 1, totalParcelas: 2,
  periodicidade: 'Mensal', observacao: '', valorMode: 'total',
});

function Stepper({ label, value, onChange, min = 1, max = 999 }) {
  const [display, setDisplay] = React.useState(String(value));

  React.useEffect(() => { setDisplay(String(value)); }, [value]);

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
      <span className="text-text-1 text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))}
          className="w-8 h-8 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-white/5 transition text-lg"
          style={{ border: '1px solid rgba(255,255,255,0.1)' }}>−</button>
        <input
          type="text"
          inputMode="numeric"
          value={display}
          onChange={handleChange}
          onBlur={handleBlur}
          className="text-text-1 font-semibold text-base text-center rounded-lg"
          style={{ width: 48, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', padding: '4px 0', outline: 'none' }}
        />
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))}
          className="w-8 h-8 rounded-full flex items-center justify-center text-text-3 hover:text-text-1 hover:bg-white/5 transition text-lg"
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
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-lg text-text-3 hover:text-text-1 hover:bg-white/5 transition">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
          <span className="text-text-1 font-semibold">Configurar Parcelas</span>
          <button onClick={concluir} className="btn-gold text-sm py-1.5 px-4">Concluir</button>
        </div>
        <div className="px-5 py-3">
          <Stepper label="Parcela inicial" value={pi} onChange={setPi} min={1} max={tp} />
          <Stepper label="Quantidade de parcelas" value={tp} onChange={v => { setTp(v); if (pi > v) setPi(v); }} min={2} max={360} />
          <div className="flex items-center justify-between py-3">
            <span className="text-text-1 text-sm">Periodicidade</span>
            <select value={per} onChange={e => setPer(e.target.value)} className="input-premium w-auto [color-scheme:dark]">
              {PERIODICIDADES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

const MONTHS_LABEL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function DropdownSelect({ id, label, options, selected, onToggle, openDropdown, setOpenDropdown }) {
  const ref = useRef(null);
  const isOpen = openDropdown === id;
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpenDropdown(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [setOpenDropdown]);
  const labelOf = (val) => options.find(o => o.val === val)?.label ?? val;
  const displayLabel = selected.length === 0 ? label
    : selected.length === 1 ? labelOf(selected[0])
    : `${labelOf(selected[0])} +${selected.length - 1}`;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpenDropdown(isOpen ? null : id)}
        className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
        style={selected.length > 0
          ? { background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }
          : { background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.08)' }
        }>
        <span className="max-w-[120px] truncate">{displayLabel}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-xl py-1 min-w-[200px] flex flex-col"
          style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 16px 40px rgba(0,0,0,0.6)', maxHeight: 260 }}>
          <p className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-widest font-bold text-text-3 flex-shrink-0">{label}</p>
          {selected.length > 0 && (
            <button onClick={() => onToggle(null)}
              className="w-full text-left px-3 py-1.5 text-[11px] text-expense hover:bg-white/5 transition flex-shrink-0">
              Limpar seleção
            </button>
          )}
          <div className="overflow-y-auto">
          {options.map(opt => (
            <label key={opt.val} onMouseDown={e => { e.preventDefault(); onToggle(opt.val); }}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-white/5 transition">
              <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                style={selected.includes(opt.val)
                  ? { background: '#22c55e', border: '1px solid #22c55e' }
                  : { background: 'transparent', border: '1px solid rgba(255,255,255,0.2)' }}>
                {selected.includes(opt.val) && (
                  <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                    <path d="M2 6l3 3 5-5" stroke="#0f172a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span className={`text-[12px] ${selected.includes(opt.val) ? 'text-text-1 font-medium' : 'text-text-2'}`}>{opt.label}</span>
            </label>
          ))}
          </div>
        </div>
      )}
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

export default function Dividas({ month, year }) {
  const now = new Date();
  // Seleção múltipla de mês/ano: array vazio = "Todos" naquele eixo. Começa com o
  // mês/ano atual selecionado, igual ao comportamento de período único de antes.
  const [selectedMonths, setSelectedMonths] = useState([String(month || now.getMonth() + 1)]);
  const [selectedYears,  setSelectedYears]  = useState([String(year  || now.getFullYear())]);

  // Sincroniza com o período global quando muda no sidebar (as setinhas de navegação
  // do menu lateral) — colapsa de volta pra seleção única daquele mês/ano.
  useEffect(() => { if (month) setSelectedMonths([String(month)]); }, [month]);
  useEffect(() => { if (year)  setSelectedYears([String(year)]);   }, [year]);

  // m/y: valor único "de referência" usado como fallback em ações que operam sobre
  // um período específico (editar, efetivar, etc.) quando não recebem mês/ano
  // explícitos — normalmente essas ações já recebem o mês/ano da própria linha
  // (d._m/d._y), então isso raramente entra em jogo.
  const m = Number(selectedMonths[0] ?? (month || now.getMonth() + 1));
  const y = Number(selectedYears[0]  ?? (year  || now.getFullYear()));
  const [dividas, setDividas] = useState(loadDividas);
  const [categorias, setCategorias] = useState(loadCategorias);

  useEffect(() => {
    const reload = () => { setDividas(loadDividas()); setCategorias(loadCategorias()); };
    window.addEventListener('planeje-sync', reload);
    return () => window.removeEventListener('planeje-sync', reload);
  }, []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState(null);
  const [filter, setFilter] = useState('todas');
  const [filterCategorias, setFilterCategorias] = useState([]);
  const [filterVencs, setFilterVencs] = useState([]);
  const [filterDias, setFilterDias] = useState([]);
  const [search, setSearch] = useState('');
  const [showCalc, setShowCalc] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [showParcelas, setShowParcelas] = useState(false);
  const [novaCategoria, setNovaCategoria] = useState('');
  const [showNovaCategoria, setShowNovaCategoria] = useState(false);
  const [efetivandoId, setEfetivandoId] = useState(null);
  const [efetivandoMes, setEfetivandoMes] = useState(null);
  const [efetivandoAno, setEfetivandoAno] = useState(null);
  const [efetivDate, setEfetivDate] = useState('');
  const [efetivValor, setEfetivValor] = useState('');
  const [efetivQuitar, setEfetivQuitar] = useState(false);
  const [detalheId, setDetalheId] = useState(null);
  const [detalheMes, setDetalheMes] = useState(null);
  const [detalheAno, setDetalheAno] = useState(null);
  const [editMes, setEditMes] = useState(null);
  const [editAno, setEditAno] = useState(null);
  const [pendingEdit, setPendingEdit] = useState(null);

  useLockBodyScroll(showForm || showParcelas || !!efetivandoId || !!detalheId || !!pendingEdit);

  const updateForm = (patch) => setForm(f => ({ ...f, ...patch }));

  const adicionarCategoria = () => {
    const nova = novaCategoria.trim();
    if (!nova || categorias.includes(nova)) { setShowNovaCategoria(false); setNovaCategoria(''); return; }
    const updated = [...categorias, nova];
    setCategorias(updated); saveCategorias(updated);
    updateForm({ categoria: nova });
    setNovaCategoria(''); setShowNovaCategoria(false);
  };

  const removerCategoria = (cat) => {
    if (CATEGORIAS_PADRAO.includes(cat)) return;
    const updated = categorias.filter(c => c !== cat);
    setCategorias(updated); saveCategorias(updated);
    if (form.categoria === cat) updateForm({ categoria: updated[0] || 'Outros' });
  };

  const handleValorChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    updateForm({ valor: raw });
  };

  const displayValor = form.valor
    ? `R$ ${(parseInt(form.valor) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : '';

  const saveItem = () => {
    if (!form.nome.trim() || !form.valor) return;
    const valorBase = parseFloat(form.valor) / 100;
    // Se modo parcela: o usuário digitou o valor de cada parcela → total = parcela × qtd
    const isParcelarMode = form.recorrencia === 'parcelar' && form.valorMode === 'parcela';
    const valorFinal = isParcelarMode ? valorBase * form.totalParcelas : valorBase;
    const novosCampos = {
      nome: form.nome.trim(), categoria: form.categoria, valor: valorFinal,
      vencimento: form.vencimento, observacao: form.observacao,
    };

    if (editId) {
      const original = dividas.find(d => d.id === editId);
      const isRecorrente = original && (original.recorrencia === 'fixa' || original.recorrencia === 'parcelar');
      if (isRecorrente) {
        const atual = getCamposMes(original, editMes ?? m, editAno ?? y);
        const novoDia = novosCampos.vencimento ? novosCampos.vencimento.split('-')[2] : '';
        const mudou = atual.nome !== novosCampos.nome
          || atual.valor !== novosCampos.valor
          || atual.categoria !== novosCampos.categoria
          || (atual.observacao || '') !== (novosCampos.observacao || '')
          || (atual.vencimentoDia || '') !== novoDia;
        if (mudou) {
          setPendingEdit(novosCampos);
          return;
        }
      }
    }
    finalizarSave(novosCampos, null);
  };

  // modo: null (não recorrente / sem mudança relevante), 'mes' (somente o mês selecionado)
  // ou 'futuro' (deste mês em diante, preservando histórico dos meses anteriores)
  const finalizarSave = (novosCampos, modo) => {
    let item;
    const em = editMes ?? m, ea = editAno ?? y;
    if (editId) {
      const original = dividas.find(d => d.id === editId);
      const isRecorrente = original.recorrencia === 'fixa' || original.recorrencia === 'parcelar';
      const baseUpdate = {
        ...original,
        recorrencia: form.recorrencia,
        parcelaInicial: form.parcelaInicial, totalParcelas: form.totalParcelas, periodicidade: form.periodicidade,
      };
      if (!isRecorrente || !modo) {
        item = { ...baseUpdate, ...novosCampos };
      } else if (modo === 'mes') {
        const key = mesKey(em, ea);
        const dia = novosCampos.vencimento ? novosCampos.vencimento.split('-')[2] : (original.vencimento || '').split('-')[2];
        item = {
          ...baseUpdate,
          overrides: {
            ...(original.overrides || {}),
            [key]: { nome: novosCampos.nome, valor: novosCampos.valor, vencimentoDia: dia, categoria: novosCampos.categoria, observacao: novosCampos.observacao },
          },
        };
      } else {
        const prevKey = mesKeyAnterior(mesKey(em, ea));
        const camposAntigos = getCamposMes(original, em, ea);
        const histEntry = {
          ate: prevKey,
          nome: camposAntigos.nome, valor: camposAntigos.valor,
          vencimentoDia: camposAntigos.vencimentoDia,
          categoria: camposAntigos.categoria, observacao: camposAntigos.observacao,
        };
        const novoDia = novosCampos.vencimento ? novosCampos.vencimento.split('-')[2] : camposAntigos.vencimentoDia;
        const [oy, om] = (original.vencimento || `${ea}-${String(em).padStart(2, '0')}-01`).split('-');
        // "Deste mês em diante" precisa valer de fato a partir daqui — sem isso, um
        // override de "apenas este mês" ou uma entrada de histórico de uma edição
        // anterior (ex: uma "deste mês em diante" que por engano tinha sido aplicada
        // a partir de um mês seguinte, deixando uma entrada de histórico com "ate"
        // cobrindo o mês atual) continuava "vencendo" o novo valor base — porque
        // getCamposMes checa overrides e depois histórico ANTES do valor base novo.
        // Limpa overrides e entradas de histórico que cobrem o mês editado em diante;
        // mantém só o que é de fato anterior a ele.
        const overridesRestantes = Object.fromEntries(
          Object.entries(original.overrides || {}).filter(([k]) => k < mesKey(em, ea))
        );
        const historicoRestante = (original.historico || []).filter(h => h.ate < mesKey(em, ea));
        item = {
          ...baseUpdate, ...novosCampos,
          vencimento: `${oy}-${om}-${novoDia}`,
          overrides: overridesRestantes,
          historico: [...historicoRestante, histEntry],
        };
      }
    } else {
      item = {
        id: newId(),
        ...novosCampos,
        recorrencia: form.recorrencia,
        parcelaInicial: form.parcelaInicial, totalParcelas: form.totalParcelas,
        periodicidade: form.periodicidade,
        pago: false, pagamentoData: null,
        criadoEm: Date.now(),
      };
    }
    if (editId) {
      const original = dividas.find(d => d.id === editId);
      const oldTotal = original.recorrencia === 'parcelar' ? parcelaValorMes(original, em, ea) : getCamposMes(original, em, ea).valor;
      const newTotal = item.recorrencia === 'parcelar' ? parcelaValorMes(item, em, ea) : getCamposMes(item, em, ea).valor;
      const status = statusMes(item, em, ea);
      // Se a conta já estava quitada com o valor antigo (pagamento integral, não parcial),
      // atualiza o valorPago junto para refletir a correção do valor.
      if (status.pago && status.valorPago != null && Math.abs(status.valorPago - oldTotal) < 0.01 && Math.abs(newTotal - oldTotal) > 0.001) {
        item = aplicarStatusMes(item, em, ea, { ...status, valorPago: newTotal });
      }
    }

    item = { ...item, updatedAt: new Date().toISOString() };
    const updated = editId ? dividas.map(d => d.id === editId ? item : d) : [item, ...dividas];
    setDividas(updated); saveDividas(updated);
    setShowForm(false); setForm(emptyForm()); setEditId(null); setEditMes(null); setEditAno(null); setPendingEdit(null);
  };

  const openEfetivar = (id, modo = 'total', mes = m, ano = y) => {
    const d = dividas.find(x => x.id === id);
    const pv = d ? parcelaValorMes(d, mes, ano) : 0;
    const st = d ? statusMes(d, mes, ano) : null;
    const jaPago = st?.valorPago || 0;
    const restante = Math.max(pv - jaPago, 0);
    setEfetivDate(st?.pagamentoData || new Date().toISOString().split('T')[0]);
    const fmtBRL = v => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    setEfetivValor(modo === 'parcial' ? '' : (restante ? fmtBRL(restante) : ''));
    setEfetivQuitar(false);
    setEfetivandoId(id);
    setEfetivandoMes(mes); setEfetivandoAno(ano);
  };

  const confirmEfetivar = () => {
    if (!efetivandoId) return;
    const mes = efetivandoMes ?? m, ano = efetivandoAno ?? y;
    const valorDigitado = parseFloat(String(efetivValor).replace(/\./g,'').replace(',','.')) || 0;
    const updated = dividas.map(d => {
      if (d.id !== efetivandoId) return d;
      const total = parcelaValorMes(d, mes, ano);
      const st = statusMes(d, mes, ano);
      const novoValorPago = (st.valorPago || 0) + valorDigitado;
      // efetivQuitar força a quitação mesmo com valor menor que o previsto (ex:
      // desconto por pagamento antecipado) — sem isso, pagar menos que o valor
      // agendado sempre ficava marcado como "falta pagar a diferença".
      const pago = efetivQuitar || novoValorPago >= total - 0.005;
      return aplicarStatusMes(d, mes, ano, { pago, pagamentoData: efetivDate, valorPago: novoValorPago });
    });
    setDividas(updated); saveDividas(updated);
    setEfetivandoId(null); setEfetivandoMes(null); setEfetivandoAno(null); setEfetivQuitar(false);
  };

  const desfazerEfetivar = (id, mes = m, ano = y) => {
    const updated = dividas.map(d => {
      if (d.id !== id) return d;
      return aplicarStatusMes(d, mes, ano, { pago: false, pagamentoData: null, valorPago: null });
    });
    setDividas(updated); saveDividas(updated);
  };

  const remove = (id) => {
    const updated = dividas.filter(d => d.id !== id);
    setDividas(updated); saveDividas(updated); setConfirmId(null);
  };

  const duplicar = (d, dataStr, mes = m, ano = y) => {
    const campos = getCamposMes(d, mes, ano);
    const novo = {
      id: newId(),
      nome: campos.nome,
      categoria: campos.categoria,
      valor: parcelaValorMes(d, mes, ano),
      vencimento: dataStr,
      observacao: campos.observacao || '',
      recorrencia: 'nao',
      pago: false, pagamentoData: null, valorPago: null,
      criadoEm: Date.now(),
      updatedAt: new Date().toISOString(),
    };
    const updated = [novo, ...dividas];
    setDividas(updated); saveDividas(updated);
  };

  const openEdit = (d, mes = m, ano = y) => {
    const campos = getCamposMes(d, mes, ano);
    let vencimentoForm = d.vencimento || '';
    if ((d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') && campos.vencimentoDia && d.vencimento) {
      vencimentoForm = `${ano}-${String(mes).padStart(2, '0')}-${campos.vencimentoDia}`;
    }
    setForm({
      nome: campos.nome, categoria: campos.categoria,
      valor: Math.round(campos.valor * 100).toString(),
      vencimento: vencimentoForm,
      recorrencia: d.recorrencia || 'nao',
      parcelaInicial: d.parcelaInicial || 1,
      totalParcelas: d.totalParcelas || 2,
      periodicidade: d.periodicidade || 'Mensal',
      observacao: campos.observacao || '',
      valorMode: 'total',
    });
    setEditId(d.id); setEditMes(mes); setEditAno(ano); setShowForm(true);
  };

  // Anos disponíveis no seletor: baseados nos dados reais cadastrados (não numa
  // janela flutuante ±N que "deriva" e pode deixar o ano atual inalcançável).
  const anosDisponiveis = React.useMemo(() => {
    const anos = new Set([new Date().getFullYear(), y, ...selectedYears.map(Number)]);
    dividas.forEach(d => {
      const dateStr = d.vencimento || d.pagamentoData;
      if (dateStr) anos.add(Number(dateStr.split('-')[0]));
    });
    return [...anos].sort((a, b) => a - b);
  }, [dividas, y, selectedYears]);

  // Cruza os meses × anos selecionados (vazio num eixo = "todos" nesse eixo) — cada
  // combinação gera linhas marcadas com seu próprio mês/ano (_m/_y) para que status
  // de pagamento, valores e ações operem no período correto daquela linha.
  const mesesParaExibir = selectedMonths.length ? selectedMonths.map(Number) : Array.from({ length: 12 }, (_, i) => i + 1);
  const anosParaExibir  = selectedYears.length  ? selectedYears.map(Number)  : anosDisponiveis;

  const dividasPeriodo = anosParaExibir.flatMap(ay =>
    mesesParaExibir.flatMap(am => filtrarPeriodo(dividas, am, ay).map(d => ({ ...d, _m: am, _y: ay })))
  );

  // Pago por fluxo de caixa real (mês do pagamento, não do vencimento) — usado
  // pela aba "Pagas" e pelo card "Quitadas". Ver loadPagasNoMes.
  const dividasPagasNoMes = anosParaExibir.flatMap(ay =>
    mesesParaExibir.flatMap(am => loadPagasNoMes(dividas, am, ay))
  );

  const today = new Date().toISOString().split('T')[0];
  const in7days = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const vencimentoPeriodo = (d, mes = m, ano = y) => {
    if (!d.vencimento) return null;
    if (d.recorrencia === 'fixa' || d.recorrencia === 'parcelar') {
      const campos = getCamposMes(d, mes, ano);
      const day = campos.vencimentoDia || d.vencimento.split('-')[2];
      return `${ano}-${String(mes).padStart(2, '0')}-${day}`;
    }
    return d.vencimento;
  };

  const recurrenceLabel = (d) => {
    if (!d.recorrencia || d.recorrencia === 'nao') return null;
    if (d.recorrencia === 'fixa') return `Fixa ${d.periodicidade || 'Mensal'}`;
    return `${d.parcelaInicial}/${d.totalParcelas}x ${d.periodicidade || 'Mensal'}`;
  };

  const toggleFilter = (arr, setArr, val) => {
    setArr(prev => prev.includes(val) ? prev.filter(x => x !== val) : [...prev, val]);
  };

  // "Pagas" usa a lista por fluxo de caixa (dividasPagasNoMes); "Todas"/"Pendentes"
  // continuam por vencimento/accrual (dividasPeriodo) — ver decisão no loadPagasNoMes.
  const baseFiltro = filter === 'pagas' ? dividasPagasNoMes : dividasPeriodo;

  const filtered = baseFiltro.filter(d => {
    const st = statusMes(d, d._m, d._y);
    const vd = vencimentoPeriodo(d, d._m, d._y) || '';
    if (filter === 'pendentes' && st.pago) return false;
    if (search.trim() && !d.nome.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filterCategorias.length > 0 && !filterCategorias.includes(d.categoria)) return false;
    if (filterVencs.length > 0) {
      const passVenc = filterVencs.some(fv => {
        if (fv === 'vencidas') return !st.pago && vd && vd < today;
        if (fv === 'hoje') return vd === today;
        if (fv === 'proximos7') return vd >= today && vd <= in7days;
        return true;
      });
      if (!passVenc) return false;
    }
    if (filterDias.length > 0) {
      const dia = vd ? String(Number(vd.split('-')[2])) : null;
      if (!dia || !filterDias.includes(dia)) return false;
    }
    return true;
  });

  // Valor real de uma linha: se já paga com valor diferente do previsto (ex: juros
  // por atraso), usa o que REALMENTE saiu da conta — não o valor previsto/agendado.
  const valorRealLinha = (d) => {
    const st = statusMes(d, d._m, d._y);
    return st.pago && st.valorPago != null ? st.valorPago : parcelaValorMes(d, d._m, d._y);
  };

  const totalPendente = dividasPeriodo.filter(d => !statusMes(d, d._m, d._y).pago).reduce((s, d) => s + parcelaValorMes(d, d._m, d._y), 0);
  const totalPago = dividasPagasNoMes.reduce((s, d) => s + valorRealLinha(d), 0);

  // Total/quantidade do resultado filtrado (busca + status + categoria + vencimento + dia).
  const totalFiltrado = filtered.reduce((s, d) => s + valorRealLinha(d), 0);
  const qtdFiltrado = filtered.length;
  const temFiltroAtivo = filter !== 'todas' || search.trim() !== '' || filterCategorias.length > 0 || filterVencs.length > 0 || filterDias.length > 0;

  // Na aba Pagas, ordena por data de PAGAMENTO (faz mais sentido pra conferir o que
  // saiu da conta em ordem cronológica); nas outras abas, por vencimento como antes.
  const sortKey = (d) => {
    if (filter === 'pagas') {
      const st = statusMes(d, d._m, d._y);
      if (st.pagamentoData) return st.pagamentoData;
    }
    return vencimentoPeriodo(d, d._m, d._y) || d.vencimento || '';
  };
  const filteredSorted = [...filtered].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  return (
    <div className="p-4 md:p-6 pb-safe-nav animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-text-1 font-bold text-lg">Transações</h2>
        <button
          onClick={() => { setForm(emptyForm()); setEditId(null); setEditMes(null); setEditAno(null); setShowForm(true); }}
          className="btn-gold flex items-center gap-1.5 py-2 px-4 text-sm"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/></svg>
          Nova
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card-premium p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-expense" />
            <p className="text-text-3 text-xs">Em aberto</p>
          </div>
          <p className="hv text-expense font-bold text-lg">{fmt(totalPendente)}</p>
          <p className="text-text-3 text-[10px] mt-0.5">{dividasPeriodo.filter(d => !statusMes(d, d._m, d._y).pago).length} registros</p>
        </div>
        <div className="card-premium p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-income" />
            <p className="text-text-3 text-xs">Quitadas</p>
          </div>
          <p className="hv text-income font-bold text-lg">{fmt(totalPago)}</p>
          <p className="text-text-3 text-[10px] mt-0.5">{dividasPagasNoMes.length} registros</p>
        </div>
      </div>

      {/* Busca */}
      <div className="relative mb-3">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none">
          <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd"/>
        </svg>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar despesa..." className="input-premium pl-9" />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 mb-3 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
        {[['todas','Todas'],['pendentes','Pendentes'],['pagas','Pagas']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className="flex-1 py-2 rounded-lg text-xs font-semibold transition-all"
            style={filter === val ? {
              background: val === 'pagas' ? 'rgba(34,197,94,0.12)' : val === 'pendentes' ? 'rgba(244,63,94,0.1)' : 'rgba(201,168,76,0.1)',
              color: val === 'pagas' ? '#22c55e' : val === 'pendentes' ? '#f43f5e' : '#c9a84c',
              border: `1px solid ${val === 'pagas' ? 'rgba(34,197,94,0.2)' : val === 'pendentes' ? 'rgba(244,63,94,0.2)' : 'rgba(201,168,76,0.2)'}`,
            } : { color: 'rgba(255,255,255,0.45)', border: '1px solid transparent' }}
          >{label}</button>
        ))}
      </div>

      {/* Filtros avançados */}
      {(() => {
        const activeCount = filterCategorias.length + filterVencs.length + filterDias.length;
        return (
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              {/* Mês e Ano — seleção múltipla; vazio = Todos */}
              <DropdownSelect
                id="mes" label="Todos os meses"
                options={MONTHS_LABEL.map((lbl, i) => ({ val: String(i + 1), label: lbl }))}
                selected={selectedMonths}
                onToggle={(val) => val === null ? setSelectedMonths([]) : toggleFilter(selectedMonths, setSelectedMonths, val)}
                openDropdown={openDropdown} setOpenDropdown={setOpenDropdown}
              />
              <DropdownSelect
                id="ano" label="Todos os anos"
                options={anosDisponiveis.map(yr => ({ val: String(yr), label: String(yr) }))}
                selected={selectedYears}
                onToggle={(val) => val === null ? setSelectedYears([]) : toggleFilter(selectedYears, setSelectedYears, val)}
                openDropdown={openDropdown} setOpenDropdown={setOpenDropdown}
              />

              {/* Vencimento dropdown */}
              <DropdownSelect
                id="venc" label="Vencimento"
                options={[
                  { val: 'vencidas', label: 'Vencidas' },
                  { val: 'hoje', label: 'Hoje' },
                  { val: 'proximos7', label: 'Próximos 7 dias' },
                ]}
                selected={filterVencs}
                onToggle={(val) => val === null ? setFilterVencs([]) : toggleFilter(filterVencs, setFilterVencs, val)}
                openDropdown={openDropdown} setOpenDropdown={setOpenDropdown}
              />

              {/* Categoria dropdown */}
              <DropdownSelect
                id="cat" label="Categoria"
                options={[...new Set([...categorias, ...dividas.map(d => d.categoria).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(c => ({ val: c, label: c }))}
                selected={filterCategorias}
                onToggle={(val) => val === null ? setFilterCategorias([]) : toggleFilter(filterCategorias, setFilterCategorias, val)}
                openDropdown={openDropdown} setOpenDropdown={setOpenDropdown}
              />

              {/* Dia dropdown */}
              <DropdownSelect
                id="dia" label="Dia"
                options={Array.from({ length: 31 }, (_, i) => { const n = String(i + 1); return { val: n, label: `Dia ${n}` }; })}
                selected={filterDias}
                onToggle={(val) => val === null ? setFilterDias([]) : toggleFilter(filterDias, setFilterDias, val)}
                openDropdown={openDropdown} setOpenDropdown={setOpenDropdown}
              />

              {/* Limpar tudo */}
              {activeCount > 0 && (
                <button onClick={() => { setFilterCategorias([]); setFilterVencs([]); setFilterDias([]); }}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{ background: 'rgba(244,63,94,0.08)', color: '#f43f5e', border: '1px solid rgba(244,63,94,0.2)' }}>
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                  Limpar ({activeCount})
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Total e quantidade do que está filtrado no momento (busca, status, categoria, vencimento, dia) */}
      {temFiltroAtivo && (
        <div className="flex items-center justify-between mb-3 px-3 py-2.5 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <span className="text-text-3 text-xs font-medium">
            {qtdFiltrado} {qtdFiltrado === 1 ? 'registro' : 'registros'}
          </span>
          <span className="hv text-text-1 text-sm font-bold">{fmt(totalFiltrado)}</span>
        </div>
      )}

      {/* List */}
      {filteredSorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-7 h-7"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
          </div>
          <p className="text-sm">Nenhuma dívida encontrada</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSorted.map((d, idx) => {
            const isParcelada = d.recorrencia === 'parcelar';
            const isFixa = d.recorrencia === 'fixa';
            const st = statusMes(d, d._m, d._y);
            const campos = getCamposMes(d, d._m, d._y);
            const today = new Date().toISOString().split('T')[0];
            const todayM = new Date().getMonth() + 1;
            const todayY = new Date().getFullYear();
            const vencAjustado = vencimentoPeriodo(d, d._m, d._y);
            const isCurrentPeriod = d._m === todayM && d._y === todayY;
            const vencida = !st.pago && vencAjustado && (
              d.recorrencia === 'nao'
                ? vencAjustado < today
                : isCurrentPeriod && vencAjustado < today
            );
            // Valor de verdade: se já paga com valor diferente do previsto (ex: juros
            // por atraso), mostra o que REALMENTE saiu da conta, não o previsto.
            const valorPrevisto = parcelaValorMes(d, d._m, d._y);
            const valorExibido = st.pago && st.valorPago != null ? st.valorPago : valorPrevisto;
            const parcelaAtual = (() => {
              if (!isParcelada || !d.vencimento) return d.parcelaInicial || 1;
              const [vy, vm] = d.vencimento.split('-').map(Number);
              const offset = (d._y * 12 + (d._m - 1)) - (vy * 12 + (vm - 1));
              return (d.parcelaInicial || 1) + offset;
            })();
            const pct = isParcelada && d.totalParcelas > 0
              ? Math.round((parcelaAtual - 1 + (st.pago ? 1 : 0)) / d.totalParcelas * 100)
              : 0;
            // Enquanto a parcela ATUAL não for confirmada como paga, a barra fica em
            // vermelho de alerta em vez de dourado — mesmo com % alto (ex: 6 de 7),
            // dourado passava a impressão de que já estava tudo certo, quando na
            // verdade ainda falta efetivar o pagamento desta parcela específica.
            const pctColor = !st.pago ? '#f43f5e' : (pct === 100 ? '#22c55e' : '#c9a84c');
            const valorColor = st.pago ? '#22c55e' : vencida ? '#f59e0b' : '#f43f5e';

            return (
              <div key={`${d.id}_${d._m}_${d._y}`} className="card-premium cursor-pointer transition-all active:scale-[0.99]"
                onClick={() => { setDetalheId(d.id); setDetalheMes(d._m); setDetalheAno(d._y); }}
              >
                <div className="px-4 pt-3.5 pb-3">

                  {/* ── Linha 1: ícone + nome + valor ── */}
                  <div className="flex items-start gap-3">
                    {/* Ícone seta */}
                    <div className="flex-shrink-0 mt-0.5">
                      {st.pago ? (
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.1)' }}>
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" style={{ color: '#22c55e', transform: 'rotate(-45deg)' }}>
                            <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                          </svg>
                        </div>
                      ) : vencida ? (
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.1)' }}>
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" style={{ color: '#f59e0b', transform: 'rotate(45deg)' }}>
                            <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                          </svg>
                        </div>
                      ) : (
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'rgba(244,63,94,0.1)' }}>
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" style={{ color: '#f43f5e', transform: 'rotate(45deg)' }}>
                            <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd"/>
                          </svg>
                        </div>
                      )}
                    </div>

                    {/* Nome + meta */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold leading-snug truncate ${st.pago ? 'line-through text-white/60' : 'text-white'}`}>
                        {campos.nome}
                      </p>
                      {/* Badges linha 2 */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-white/70">{campos.categoria}</span>
                        {isFixa && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(201,168,76,0.12)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.2)' }}>
                            Fixa · {d.periodicidade || 'Mensal'}
                          </span>
                        )}
                        {isParcelada && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(201,168,76,0.12)', color: '#c9a84c', border: '1px solid rgba(201,168,76,0.2)' }}>
                            {parcelaAtual}/{d.totalParcelas}x · {d.periodicidade || 'Mensal'}
                          </span>
                        )}
                        {vencida && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                            Vencida
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Valor */}
                    <div className="flex-shrink-0 text-right">
                      <p className="hv text-sm font-bold" style={{ color: valorColor }}>{fmt(valorExibido)}</p>
                      {valorExibido !== valorPrevisto && (
                        <p className="text-[10px] text-white/50">previsto {fmt(valorPrevisto)}</p>
                      )}
                      {isParcelada && (
                        <p className="text-[10px] text-white/60">por parcela</p>
                      )}
                    </div>
                  </div>

                  {/* ── Linha 3: vencimento ── */}
                  {vencAjustado && (
                    <div className="flex items-center gap-1.5 mt-2 ml-12">
                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 flex-shrink-0" style={{ color: vencida ? '#f59e0b' : 'rgba(255,255,255,0.35)' }}>
                        <path d="M3.5 0a.5.5 0 01.5.5V1h8V.5a.5.5 0 011 0V1h1a2 2 0 012 2v11a2 2 0 01-2 2H2a2 2 0 01-2-2V3a2 2 0 012-2h1V.5a.5.5 0 01.5-.5zM1 4v10a1 1 0 001 1h12a1 1 0 001-1V4H1z"/>
                      </svg>
                      <span className="text-[11px] font-medium" style={{ color: vencida ? '#f59e0b' : 'rgba(255,255,255,0.8)' }}>
                        Venc: {fmtDate(vencAjustado)}
                      </span>
                      {st.pago && st.pagamentoData && (
                        <span className="text-[11px] text-income ml-1">· Pago {fmtDate(st.pagamentoData)}</span>
                      )}
                    </div>
                  )}

                  {/* ── Pagamento parcial: valor já pago e restante ── */}
                  {!st.pago && st.valorPago > 0 && (
                    <div className="flex items-center gap-1.5 mt-1.5 ml-12 flex-wrap">
                      <span className="text-[11px] text-income">
                        Pago {fmt(st.valorPago)}{st.pagamentoData ? ` em ${fmtDate(st.pagamentoData)}` : ''}
                      </span>
                      <span className="text-[11px] text-white/50">
                        · Restam {fmt(Math.max(parcelaValorMes(d, d._m, d._y) - st.valorPago, 0))}
                      </span>
                      <button onClick={(e) => { e.stopPropagation(); desfazerEfetivar(d.id, d._m, d._y); }}
                        className="text-[11px] text-white/40 hover:text-white/70 transition">
                        ↩ Desfazer
                      </button>
                    </div>
                  )}

                  {/* ── Progress bar parcelas ── */}
                  {isParcelada && (
                    <div className="mt-2 ml-12">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-white/70">{parcelaAtual - 1 + (st.pago ? 1 : 0)} de {d.totalParcelas} pagas</span>
                        <span className="text-[10px] font-semibold" style={{ color: pctColor }}>{pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pctColor }} />
                      </div>
                    </div>
                  )}

                  {/* ── Linha ações ── */}
                  <div className="flex items-center justify-between mt-3 ml-12" onClick={e => e.stopPropagation()}>
                    {/* Efetivar / status */}
                    <div>
                      {!st.pago ? (
                        <button onClick={() => openEfetivar(d.id, 'total', d._m, d._y)}
                          className="text-xs font-semibold px-3 py-1 rounded-lg transition-all"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}>
                          Efetivar pagamento
                        </button>
                      ) : (
                        <span className="text-[11px] font-medium text-income">✓ Quitada</span>
                      )}
                    </div>
                    {/* Ações */}
                    <div className="flex items-center gap-1">
                      {confirmId === `${d.id}_${d._m}_${d._y}` ? (
                        <div className="flex items-center gap-1">
                          <span className="text-text-3 text-[11px]">Excluir?</span>
                          <button onClick={() => remove(d.id)} className="text-expense text-xs font-bold px-2 py-1 rounded-lg" style={{ background: 'rgba(244,63,94,0.1)', border: '1px solid rgba(244,63,94,0.2)' }}>✓</button>
                          <button onClick={() => setConfirmId(null)} className="text-white/40 text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>✕</button>
                        </div>
                      ) : (
                        <AcoesMenu
                          onEdit={() => openEdit(d, d._m, d._y)}
                          onPagamentoParcial={() => openEfetivar(d.id, 'parcial', d._m, d._y)}
                          onDuplicar={(dataStr) => duplicar(d, dataStr, d._m, d._y)}
                          onExcluir={() => setConfirmId(`${d.id}_${d._m}_${d._y}`)}
                          vencimentoAtual={vencAjustado}
                          openUp={idx >= filteredSorted.length - 2}
                        />
                      )}
                    </div>
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {detalheId && (() => {
        const d = dividas.find(x => x.id === detalheId);
        if (!d) return null;
        const today = new Date().toISOString().split('T')[0];
        const todayM = new Date().getMonth() + 1;
        const todayY = new Date().getFullYear();
        const isParcelada = d.recorrencia === 'parcelar';
        const isFixa = d.recorrencia === 'fixa';
        const dm = detalheMes ?? m, dy = detalheAno ?? y;
        const st = statusMes(d, dm, dy);
        const campos = getCamposMes(d, dm, dy);
        const vencAjustadoDetalhe = vencimentoPeriodo(d, dm, dy);
        const isCurrentPeriodDetalhe = dm === todayM && dy === todayY;
        const vencida = !st.pago && vencAjustadoDetalhe && (
          d.recorrencia === 'nao'
            ? vencAjustadoDetalhe < today
            : isCurrentPeriodDetalhe && vencAjustadoDetalhe < today
        );
        const pv = parcelaValorMes(d, dm, dy);
        // Valor de verdade a exibir: se já foi paga com um valor diferente do previsto
        // (ex: juros por atraso), mostra o que REALMENTE saiu da conta, não o previsto.
        const pvExibido = st.pago && st.valorPago != null ? st.valorPago : pv;

        // Progresso parcelamento
        const parcelasPagas = isParcelada ? (d.parcelaInicial - 1 + (st.pago ? 1 : 0)) : 0;
        const parcelasPendentes = isParcelada ? (d.totalParcelas - parcelasPagas) : 0;
        const valorEfetivado = isParcelada ? parcelasPagas * pv : (st.pago ? pv : 0);
        const valorPendente = isParcelada ? parcelasPendentes * pv : (st.pago ? 0 : pv);
        const progressPct = isParcelada && d.totalParcelas > 0 ? Math.round(parcelasPagas / d.totalParcelas * 100) : 0;
        // Mesma regra da lista: enquanto a parcela atual não for paga, cor de alerta
        // em vez de dourado — evita dar a impressão de que já está tudo em dia.
        const progressColor = !st.pago ? '#f43f5e' : (progressPct === 100 ? '#22c55e' : '#c9a84c');

        // Dias de atraso
        let diasAtraso = 0;
        if (vencida && vencAjustadoDetalhe) {
          const venc = new Date(vencAjustadoDetalhe + 'T00:00:00');
          const now = new Date();
          diasAtraso = Math.floor((now - venc) / 86400000);
        }

        const situacao = st.pago ? 'Paga' : vencida ? 'Vencida' : 'Em aberto';
        const situacaoColor = st.pago ? 'text-income' : vencida ? 'text-yellow-500' : 'text-text-2';

        return createPortal(
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
            <div className="relative w-full max-w-md rounded-[1.5rem] shadow-2xl overflow-hidden animate-scale-in"
              style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '92vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>


              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <button onClick={() => { setDetalheId(null); setDetalheMes(null); setDetalheAno(null); }} className="w-11 h-11 flex items-center justify-center rounded-lg text-text-3 hover:text-text-1 hover:bg-white/5 transition">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                </button>
                <span className="text-text-2 text-sm font-medium">Detalhes</span>
                <div className="flex gap-1">
                  <button onClick={() => { setDetalheId(null); openEdit(d, dm, dy); }} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-3 hover:text-gold hover:bg-white/5 transition">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M12.854.146a.5.5 0 00-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 000-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 016 13.5V13h-.5a.5.5 0 01-.5-.5V12h-.5a.5.5 0 01-.5-.5V11h-.5a.5.5 0 01-.5-.5V10h-.5a.499.499 0 01-.175-.032l-.179.178a.5.5 0 00-.11.168l-2 5a.5.5 0 00.65.65l5-2a.5.5 0 00.168-.11l.178-.178z"/></svg>
                  </button>
                  <button onClick={() => { remove(d.id); setDetalheId(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg text-text-3 hover:text-expense hover:bg-white/5 transition">
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5"><path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/><path fillRule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" clipRule="evenodd"/></svg>
                  </button>
                </div>
              </div>

              {/* Nome + valor */}
              <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-text-1 font-bold text-lg leading-tight">{campos.nome}</p>
                    <p className="text-text-3 text-xs mt-1">{campos.categoria}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className={`text-2xl font-bold ${st.pago ? 'text-income' : vencida ? 'text-yellow-500' : 'text-expense'}`}>
                      {fmt(pvExibido)}
                    </p>
                    {pvExibido !== pv && <p className="text-text-3 text-xs">previsto {fmt(pv)}</p>}
                    {isParcelada && <p className="text-text-3 text-xs">por parcela</p>}
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Detalhes básicos */}
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-text-3 text-[10px] font-semibold uppercase tracking-widest px-4 py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>Detalhes</p>
                  <DetailRow label="Situação" value={<span className={`font-semibold ${situacaoColor}`}>{situacao}</span>} />
                  <DetailRow label="Recorrência" value={isParcelada ? 'Parcelada' : isFixa ? `Fixa ${d.periodicidade}` : 'Única'} />
                  {diasAtraso > 0 && <DetailRow label="Dias de atraso" value={<span className="text-yellow-500 font-semibold">{diasAtraso} dias</span>} />}
                  {!st.pago && st.valorPago > 0 && (
                    <>
                      <DetailRow label="Pago parcialmente" value={<span className="text-income font-semibold">{fmt(st.valorPago)}</span>} />
                      <DetailRow label="Restante" value={<span className="font-semibold">{fmt(Math.max(pv - st.valorPago, 0))}</span>} />
                    </>
                  )}
                </div>

                {/* Parcelamento */}
                {isParcelada && (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-text-3 text-[10px] font-semibold uppercase tracking-widest px-4 py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>Parcelamento</p>
                    <DetailRow label="Parcelas" value={<span className="font-semibold text-text-1">{d.parcelaInicial}/{d.totalParcelas}</span>} />
                    <DetailRow label="Periodicidade" value={d.periodicidade || 'Mensal'} />
                    <DetailRow label="Valor total" value={<span className="font-semibold">{fmt(d.valor)}</span>} />
                    <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-text-3 text-xs">Efetivado / Pendente</span>
                        <span className="text-text-2 text-xs font-medium">{fmt(valorEfetivado)} / {fmt(valorPendente)}</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full transition-all"
                          style={{ width: `${progressPct}%`, background: progressColor }} />
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-text-3 text-[10px]">{parcelasPagas} pagas</span>
                        <span className="text-[10px] font-medium" style={{ color: progressColor }}>{progressPct}%</span>
                        <span className="text-text-3 text-[10px]">{parcelasPendentes} pendentes</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Datas */}
                <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-text-3 text-[10px] font-semibold uppercase tracking-widest px-4 py-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>Datas</p>
                  {vencAjustadoDetalhe && <DetailRow label="Vencimento" value={fmtDate(vencAjustadoDetalhe)} />}
                  {st.pagamentoData && <DetailRow label="Pagamento" value={<span className="text-income font-medium">{fmtDate(st.pagamentoData)}</span>} />}
                  {!vencAjustadoDetalhe && !st.pagamentoData && <p className="text-text-3 text-xs px-4 py-3">Nenhuma data informada</p>}
                </div>

                {/* Observação */}
                {campos.observacao && (
                  <div className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <p className="text-text-3 text-[10px] font-semibold uppercase tracking-widest mb-1.5">Observação</p>
                    <p className="text-text-2 text-sm">{campos.observacao}</p>
                  </div>
                )}

                {/* Efetivar / Desfazer */}
                <div className="pb-2">
                  {st.pago ? (
                    <button onClick={() => { desfazerEfetivar(d.id, dm, dy); setDetalheId(null); }}
                      className="btn-ghost w-full text-center text-sm">
                      Desfazer pagamento
                    </button>
                  ) : (
                    <button onClick={() => { setDetalheId(null); openEfetivar(d.id, 'total', dm, dy); }}
                      className="btn-gold w-full text-center">
                      Efetivar pagamento
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        , document.body);
      })()}

      {/* Form modal */}
      {showForm && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
          <div
            className="relative w-full max-w-md rounded-[1.5rem] shadow-2xl overflow-x-hidden overflow-y-auto"
            style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '92vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between px-5 py-4 z-10"
              style={{ background: '#0d1117', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <button onClick={() => setShowForm(false)} className="w-11 h-11 flex items-center justify-center rounded-lg text-text-3 hover:text-text-1 hover:bg-white/5 transition">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
              </button>
              <h3 className="text-text-1 font-semibold">{editId ? 'Editar Dívida' : 'Nova Dívida'}</h3>
              <button onClick={saveItem} disabled={!form.nome.trim() || !form.valor}
                className="btn-gold py-1.5 px-4 text-sm disabled:opacity-40">
                Salvar
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-text-3 text-xs font-medium block mb-1.5">Descrição</label>
                <input value={form.nome} onChange={e => updateForm({ nome: e.target.value })}
                  placeholder="Ex: Cartão Nubank, Empréstimo..." className="input-premium" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-text-3 text-xs font-medium block mb-1.5">Valor</label>
                  <div className="relative">
                    <input type="text" inputMode="numeric" value={displayValor} onChange={handleValorChange}
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
                  <label className="text-text-3 text-xs font-medium block mb-1.5">Vencimento</label>
                  <input type="date" value={form.vencimento} onChange={e => updateForm({ vencimento: e.target.value })}
                    className="input-premium [color-scheme:dark]" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-text-3 text-xs font-medium">Categoria</label>
                  <button type="button" onClick={() => setShowNovaCategoria(v => !v)}
                    className="text-gold text-xs hover:text-gold-light transition flex items-center gap-1">
                    <span>+</span> Nova categoria
                  </button>
                </div>
                {showNovaCategoria && (
                  <div className="flex gap-2 mb-2">
                    <input autoFocus value={novaCategoria} onChange={e => setNovaCategoria(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') adicionarCategoria(); if (e.key === 'Escape') { setShowNovaCategoria(false); setNovaCategoria(''); } }}
                      placeholder="Nome da categoria..." className="input-premium flex-1" />
                    <button type="button" onClick={adicionarCategoria} className="btn-gold py-2 px-3 text-sm">OK</button>
                  </div>
                )}
                <SelectDown
                  value={form.categoria}
                  onChange={v => updateForm({ categoria: v })}
                  options={categorias}
                  className="input-premium w-full"
                />
                {categorias.filter(c => !CATEGORIAS_PADRAO.includes(c)).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {categorias.filter(c => !CATEGORIAS_PADRAO.includes(c)).map(c => (
                      <div key={c} className="flex items-center gap-1 badge text-gold"
                        style={{ background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.2)' }}>
                        <span className="text-[10px]">{c}</span>
                        <button type="button" onClick={() => removerCategoria(c)} className="text-gold/50 hover:text-expense transition text-xs leading-none">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recorrência */}
              <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="px-4 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <p className="text-text-3 text-[10px] font-semibold uppercase tracking-widest">Recorrência</p>
                </div>
                {[
                  { val: 'nao', label: 'Não recorrente', desc: 'Cobrança única' },
                  { val: 'parcelar', label: 'Parcelar ou repetir', desc: 'Define parcelas e periodicidade' },
                  { val: 'fixa', label: 'Fixa mensal', desc: 'Repete todo mês automaticamente' },
                ].map((opt, i, arr) => (
                  <div key={opt.val} style={{ borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <label className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/2 transition">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${form.recorrencia === opt.val ? 'border-2 border-gold' : 'border border-text-3'}`}>
                        {form.recorrencia === opt.val && <div className="w-2 h-2 rounded-full bg-gold" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-text-1 text-sm">{opt.label}</p>
                        <p className="text-text-3 text-[10px]">{opt.desc}</p>
                      </div>
                      <input type="radio" className="hidden" checked={form.recorrencia === opt.val} onChange={() => updateForm({ recorrencia: opt.val })} />
                    </label>
                    {opt.val === 'parcelar' && form.recorrencia === 'parcelar' && (
                      <>
                        <button type="button" onClick={() => setShowParcelas(true)}
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/3 transition"
                          style={{ background: 'rgba(34,197,94,0.04)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          <div className="flex items-center gap-2">
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-accent"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
                            <span className="text-text-1 text-sm">Parcela {form.parcelaInicial}/{form.totalParcelas} · {form.periodicidade}</span>
                          </div>
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-text-3"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
                        </button>
                        {/* Toggle: Valor total vs Valor parcela */}
                        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(0,0,0,0.15)' }}>
                          <p className="text-text-3 text-[10px] font-semibold uppercase tracking-widest mb-2">O valor informado é</p>
                          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid rgba(34,197,94,0.2)' }}>
                            {[['total','Valor total','O total será dividido pelas parcelas'],['parcela','Valor parcela','Cada parcela terá esse valor fixo']].map(([mode, label, hint]) => (
                              <button key={mode} type="button"
                                onClick={() => updateForm({ valorMode: mode })}
                                className="flex-1 py-2.5 px-2 text-xs font-semibold transition-all text-center"
                                style={form.valorMode === mode ? {
                                  background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                                  color: '#0f172a',
                                } : { color: 'rgba(255,255,255,0.45)', background: 'transparent' }}>
                                {label}
                              </button>
                            ))}
                          </div>
                          <p className="text-text-3 text-[10px] mt-1.5">
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
                <label className="text-text-3 text-xs font-medium block mb-1.5">Observação</label>
                <input value={form.observacao} onChange={e => updateForm({ observacao: e.target.value })}
                  placeholder="Opcional..." className="input-premium" />
              </div>
              <button
                onClick={saveItem}
                disabled={!form.nome.trim() || !form.valor}
                className="btn-gold w-full text-center disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Pop-up: aplicar alteração só neste mês ou deste mês em diante */}
      {pendingEdit && (() => {
        const original = dividas.find(x => x.id === editId);
        const tipo = original?.recorrencia === 'fixa' ? 'fixa' : 'parcelada';
        return createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
            <div className="absolute inset-0 bg-black/70" style={{ backdropFilter: 'blur(8px)' }} />
            <div className="relative card-premium p-6 w-full max-w-sm animate-scale-in" onClick={e => e.stopPropagation()}>
              <h3 className="text-text-1 font-bold text-base mb-2">Como deseja aplicar essas alterações?</h3>
              <p className="text-text-3 text-sm mb-4">
                Essa é uma transação {tipo} e você pode escolher entre aplicar essas alterações apenas para o mês selecionado ({MONTHS_LABEL[(editMes ?? m) - 1].toLowerCase()}) ou dele em diante.
              </p>
              <div className="flex flex-col gap-2">
                <button onClick={() => finalizarSave(pendingEdit, 'mes')} className="btn-gold w-full text-center text-sm">
                  Apenas no mês selecionado
                </button>
                <button onClick={() => finalizarSave(pendingEdit, 'futuro')} className="btn-ghost w-full text-center text-sm">
                  Mês selecionado em diante
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}

      {/* Parcelas modal */}
      {showParcelas && createPortal(
        <ConfigurarParcelas
          parcelaInicial={form.parcelaInicial} totalParcelas={form.totalParcelas} periodicidade={form.periodicidade}
          onChange={({ parcelaInicial, totalParcelas, periodicidade }) => updateForm({ parcelaInicial, totalParcelas, periodicidade })}
          onClose={() => setShowParcelas(false)}
        />,
        document.body
      )}

      {/* Efetivar modal */}
      {efetivandoId && (() => {
        const d = dividas.find(x => x.id === efetivandoId);
        const emes = efetivandoMes ?? m, eano = efetivandoAno ?? y;
        const total = d ? parcelaValorMes(d, emes, eano) : 0;
        const st = d ? statusMes(d, emes, eano) : null;
        const jaPago = st?.valorPago || 0;
        const restante = Math.max(total - jaPago, 0);
        return createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/70" style={{ backdropFilter: 'blur(8px)' }} />
          <div className="relative card-premium p-6 w-full max-w-xs animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.1)' }}>
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-income"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd"/></svg>
              </div>
              <div>
                <h3 className="text-text-1 font-semibold">Efetivar pagamento</h3>
                <p className="text-text-3 text-xs">Confirme data e valor pago</p>
              </div>
            </div>
            {jaPago > 0 && (
              <div className="mb-3 rounded-xl px-3 py-2 text-[11px]" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p className="text-text-3">Valor total: <span className="text-text-1 font-medium">{fmt(total)}</span></p>
                <p className="text-income">Já pago: <span className="font-medium">{fmt(jaPago)}</span></p>
                <p className="text-white/70">Restante: <span className="font-medium">{fmt(restante)}</span></p>
              </div>
            )}
            <div className="mb-3">
              <label className="text-text-3 text-xs block mb-1.5">Data do pagamento</label>
              <input type="date" value={efetivDate} onChange={e => setEfetivDate(e.target.value)}
                className="input-premium [color-scheme:dark]" />
            </div>
            <div className="mb-4">
              <label className="text-text-3 text-xs block mb-1.5">
                {jaPago > 0 ? 'Valor pago agora' : 'Valor pago'} <span className="text-text-3 font-normal">(pode alterar se houve juros ou for parcial)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 text-sm">R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={efetivValor}
                  onChange={e => setEfetivValor(e.target.value)}
                  className="input-premium pl-9"
                  placeholder="0,00"
                />
              </div>
            </div>
            <label className="flex items-start gap-2 mb-4 cursor-pointer">
              <input type="checkbox" checked={efetivQuitar} onChange={e => setEfetivQuitar(e.target.checked)}
                className="mt-0.5" style={{ accentColor: '#22c55e' }} />
              <span className="text-text-3 text-[11px] leading-snug">
                Quitar mesmo que o valor seja diferente do previsto <span className="text-text-3/70">(ex: desconto por pagamento antecipado, negociação)</span>
              </span>
            </label>
            <div className="flex gap-2">
              <button onClick={() => { setEfetivandoId(null); setEfetivandoMes(null); setEfetivandoAno(null); setEfetivQuitar(false); }} className="btn-ghost flex-1">Cancelar</button>
              <button onClick={confirmEfetivar} className="btn-gold flex-1 text-center">Confirmar</button>
            </div>
          </div>
        </div>,
        document.body
        );
      })()}

      {showCalc && (
        <CalculatorModal
          initialValue={form.valor ? parseInt(form.valor) / 100 : 0}
          onClose={() => setShowCalc(false)}
          onConfirm={(val) => { updateForm({ valor: Math.round(val * 100).toString() }); setShowCalc(false); }}
        />
      )}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <span className="text-text-3 text-sm">{label}</span>
      <span className="text-text-2 text-sm text-right">{value}</span>
    </div>
  );
}
