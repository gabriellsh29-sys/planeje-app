import React, { useState, useEffect, useRef } from 'react';
import CalculatorModal from './CalculatorModal';

const today = () => new Date().toISOString().split('T')[0];

const CATEGORIES_EXPENSE = [
  'Alimentação','Moradia','Transporte','Saúde','Educação',
  'Lazer','Vestuário','Cartão de Crédito','Empréstimo','Financiamento',
  'Conta/Serviço','Impostos','Família','Outros',
];

const CATEGORIES_INCOME = [
  'Salário','Freelance','Investimentos','Aluguel','Reembolso','Outros',
];

const CAT_KEY_EXPENSE = 'financeiro_categorias_divida';
const CAT_KEY_INCOME  = 'financeiro_categorias_receita';

function loadExtraCats(key, defaults) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') || [];
    const merged = [...defaults];
    saved.forEach(c => { if (!merged.includes(c)) merged.push(c); });
    return merged;
  } catch { return defaults; }
}

function saveExtraCat(key, defaults, novaCat) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(key) || 'null') || []; } catch { return []; } })();
  const all = [...defaults, ...saved];
  if (all.includes(novaCat)) return;
  localStorage.setItem(key, JSON.stringify([...saved, novaCat]));
}

export default function TransactionForm({ onSave, onClose, defaultType }) {
  const [type, setType] = useState(defaultType || 'expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState('Outros');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [categories, setCategories] = useState(() => loadExtraCats(CAT_KEY_EXPENSE, CATEGORIES_EXPENSE));
  const [showCateg, setShowCateg] = useState(false);
  const [novaCateg, setNovaCateg] = useState('');
  const [showCalc, setShowCalc] = useState(false);
  const descRef = useRef(null);

  useEffect(() => { setTimeout(() => descRef.current?.focus(), 80); }, []);
  useEffect(() => {
    setCategory('Outros');
    setCategories(type === 'expense'
      ? loadExtraCats(CAT_KEY_EXPENSE, CATEGORIES_EXPENSE)
      : loadExtraCats(CAT_KEY_INCOME, CATEGORIES_INCOME));
    setShowCateg(false);
    setNovaCateg('');
  }, [type]);

  const addCateg = () => {
    const n = novaCateg.trim();
    if (!n) { setShowCateg(false); setNovaCateg(''); return; }
    if (categories.includes(n)) {
      setCategory(n);
      setShowCateg(false); setNovaCateg('');
      return;
    }
    const defaults = type === 'expense' ? CATEGORIES_EXPENSE : CATEGORIES_INCOME;
    const key = type === 'expense' ? CAT_KEY_EXPENSE : CAT_KEY_INCOME;
    saveExtraCat(key, defaults, n);
    setCategories([...categories, n]);
    setCategory(n);
    setShowCateg(false); setNovaCateg('');
  };

  const handleAmountChange = (e) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) { setAmount(''); return; }
    setAmount((parseInt(raw) / 100).toFixed(2));
  };

  const displayAmount = amount
    ? `R$ ${parseFloat(amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) { setError('Informe um valor válido'); return; }
    if (!description.trim()) { setError('Informe uma descrição'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({ type, amount: parseFloat(amount), description: description.trim(), date, category });
      onClose();
    } catch (err) {
      setError(err.response?.data?.errors?.[0]?.msg || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const isExpense = type === 'expense';

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/75" style={{ backdropFilter: 'blur(8px)' }} />
      <div
        className="relative w-full max-w-md rounded-t-[1.75rem] md:rounded-[1.5rem] shadow-2xl animate-scale-in overflow-hidden"
        style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.08)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle (mobile) */}
        <div className="md:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.12)' }} />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-lg text-text-3 hover:text-text-1 hover:bg-white/5 transition">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
          </button>
          <h2 className="text-text-1 font-semibold text-base">Nova Transação</h2>
          <div className="w-8" />
        </div>

        <div className="px-5 pt-4 pb-6">
          {/* Type switcher */}
          <div className="flex gap-1.5 mb-5 p-1 rounded-xl" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <button
              type="button"
              onClick={() => setType('expense')}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
              style={isExpense ? {
                background: 'rgba(244,63,94,0.15)', color: '#f43f5e',
                border: '1px solid rgba(244,63,94,0.25)',
              } : { color: 'rgba(255,255,255,0.45)', border: '1px solid transparent' }}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => setType('income')}
              className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all"
              style={!isExpense ? {
                background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.2)',
              } : { color: 'rgba(255,255,255,0.45)', border: '1px solid transparent' }}
            >
              Receita
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-text-3 text-xs font-medium block mb-1.5">Descrição</label>
              <input
                ref={descRef}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Ex: Almoço, Salário..."
                className="input-premium"
                maxLength={255}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-text-3 text-xs font-medium block mb-1.5">Valor</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={displayAmount}
                    onChange={handleAmountChange}
                    placeholder="R$ 0,00"
                    className="input-premium pr-9"
                  />
                  <button type="button" onClick={() => setShowCalc(true)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-3 hover:text-accent transition">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path fillRule="evenodd" d="M5 2a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V4a2 2 0 00-2-2H5zm0 2h10v3H5V4zm0 5h2v2H5V9zm3 0h2v2H8V9zm3 0h2v2h-2V9zm-6 4h2v2H5v-2zm3 0h2v2H8v-2zm3 0h2v4h-2v-4z" clipRule="evenodd"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div>
                <label className="text-text-3 text-xs font-medium block mb-1.5">Data</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="input-premium [color-scheme:dark]"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-text-3 text-xs font-medium">Categoria</label>
                <button type="button" onClick={() => setShowCateg(v => !v)}
                  className="text-gold text-xs hover:opacity-80 transition">+ Nova</button>
              </div>
              {showCateg && (
                <div className="flex gap-2 mb-2">
                  <input autoFocus value={novaCateg} onChange={e => setNovaCateg(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCateg(); } if (e.key === 'Escape') setShowCateg(false); }}
                    placeholder="Nome..." className="input-premium flex-1" />
                  <button type="button" onClick={addCateg} className="btn-gold py-2 px-3 text-sm">OK</button>
                </div>
              )}
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="input-premium [color-scheme:dark]"
              >
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {error && (
              <div className="text-expense text-xs text-center px-3 py-2 rounded-xl"
                style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.15)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full py-3.5 rounded-xl font-bold text-sm transition-all disabled:opacity-50 mt-1"
              style={isExpense ? {
                background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
                color: '#fff', boxShadow: '0 4px 16px rgba(244,63,94,0.25)',
              } : {
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: '#fff', boxShadow: '0 4px 16px rgba(34,197,94,0.2)',
              }}
            >
              {saving ? 'Salvando...' : `Salvar ${isExpense ? 'Despesa' : 'Receita'}`}
            </button>
          </form>
        </div>
      </div>

      {showCalc && (
        <CalculatorModal
          initialValue={amount || 0}
          onClose={() => setShowCalc(false)}
          onConfirm={(val) => { setAmount(val.toFixed(2)); setShowCalc(false); }}
        />
      )}
    </div>
  );
}
