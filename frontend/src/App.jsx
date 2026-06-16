import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './components/LoginPage';
import ResetPasswordPage from './components/ResetPasswordPage';
import PaywallPage from './components/PaywallPage';
import Sidebar from './components/Sidebar';
import TransactionForm from './components/TransactionForm';
import Resumo from './pages/Resumo';
import Despesas from './pages/Dividas';
import Receitas from './pages/Receitas';
import Graficos from './pages/Graficos';
import Anotacoes from './pages/Anotacoes';
import Planejamento from './pages/Planejamento';
import CartaoCredito from './pages/CartaoCredito';
import Perfil from './pages/Perfil';
import TrialBanner from './components/TrialBanner';
import { useTransactions } from './hooks/useTransactions';

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const PAGE_TITLES = {
  resumo: 'Resumo',
  transacoes: 'Transações',
  planejamento: 'Planejamento',
  graficos: 'Gráficos',
  anotacoes: 'Anotações',
  perfil: 'Perfil',
};

function TransacoesWrapper({ month, year }) {
  const [tab, setTab] = useState('despesas');
  const TABS = [
    { val: 'despesas', lbl: '💸 Despesas', cor: '#f43f5e' },
    { val: 'receitas', lbl: '💰 Receitas', cor: '#22c55e' },
    { val: 'cartao',   lbl: '💳 Cartão',   cor: '#c9a84c' },
  ];
  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-0 px-4 pt-4 pb-0 flex-shrink-0 overflow-x-auto">
        {TABS.map(({ val, lbl, cor }) => (
          <button key={val} onClick={() => setTab(val)}
            className="flex-1 min-w-[6rem] py-2.5 text-sm font-semibold transition-all rounded-t-xl whitespace-nowrap"
            style={tab === val
              ? { background: 'rgba(255,255,255,0.06)', color: '#ffffff', borderBottom: `2px solid ${cor}` }
              : { color: 'rgba(255,255,255,0.4)', borderBottom: '2px solid transparent' }}>
            {lbl}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {tab === 'despesas' && <Despesas month={month} year={year} />}
        {tab === 'receitas' && <Receitas month={month} year={year} />}
        {tab === 'cartao'   && <CartaoCredito month={month} year={year} />}
      </div>
    </div>
  );
}

function Dashboard() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [page,  setPage]  = useState('resumo');
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState('expense');
  const [refreshKey, setRefreshKey] = useState(0);
  const { addTransaction } = useTransactions(month, year);

  const handleAddTransaction = async (data) => {
    await addTransaction(data);
    setRefreshKey(k => k + 1);
  };

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };
  const goToToday = () => { const n = new Date(); setMonth(n.getMonth() + 1); setYear(n.getFullYear()); };

  const showFab = page === 'resumo';

  return (
    <div className="flex min-h-screen" style={{ background: '#0f172a' }}>
      <Sidebar page={page} setPage={setPage} month={month} year={year} onPrev={prevMonth} onNext={nextMonth} onToday={goToToday} />

      <main className="flex-1 flex flex-col overflow-hidden md:pl-0">
        <TrialBanner onClickPlanos={() => setPage('perfil')} />

        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-20 flex flex-col flex-shrink-0"
          style={{ background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(34,197,94,0.12)' }}>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-text-1 font-bold text-base">{PAGE_TITLES[page]}</span>
            <div className="flex items-center gap-1.5">
              <button onClick={goToToday}
                className="text-[9px] font-semibold px-2 py-0.5 rounded-full transition-all"
                style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
                Mês Atual
              </button>
              <button onClick={prevMonth} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-3 hover:text-accent hover:bg-white/5 transition">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
              </button>
              <span className="text-text-2 text-sm font-medium min-w-[5rem] text-center">
                {MONTHS[month - 1].slice(0, 3)} {year}
              </span>
              <button onClick={nextMonth} className="w-7 h-7 rounded-lg flex items-center justify-center text-text-3 hover:text-accent hover:bg-white/5 transition">
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4-4a1 1 0 01-1.414 0z" clipRule="evenodd"/></svg>
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-16 md:pb-0">
          {page === 'resumo'       && <Resumo key={refreshKey} month={month} year={year} />}
          {page === 'transacoes'   && <TransacoesWrapper key={refreshKey} month={month} year={year} />}
          {page === 'planejamento' && <Planejamento key={refreshKey} month={month} year={year} />}
          {page === 'graficos'     && <Graficos key={refreshKey} month={month} year={year} />}
          {page === 'anotacoes'    && <Anotacoes />}
          {page === 'perfil'       && <Perfil />}
        </div>
      </main>

      {/* FAB */}
      {showFab && (
        <button
          onClick={() => { setFormType('expense'); setShowForm(true); }}
          className="fixed bottom-20 right-5 md:bottom-8 md:right-8 w-14 h-14 rounded-full text-[#07090f] text-2xl font-bold shadow-xl flex items-center justify-center active:scale-90 transition-all duration-150 z-30"
          style={{ background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', boxShadow: '0 8px 32px rgba(34,197,94,0.4)' }}
          aria-label="Nova transação">
          +
        </button>
      )}

      {showForm && (
        <TransactionForm onSave={handleAddTransaction} onClose={() => setShowForm(false)} defaultType={formType} />
      )}
    </div>
  );
}

function AppContent() {
  const { user, loading, acessoLiberado, isRecovery } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
        <div className="flex flex-col items-center gap-4">
          <img src="/img/logo/logo-app-icon.png" alt="Planeje" className="w-24 h-24 object-contain rounded-2xl" />
          <div className="w-6 h-6 border-2 rounded-full animate-spin"
            style={{ borderColor: 'rgba(34,197,94,0.2)', borderTopColor: '#22c55e' }} />
        </div>
      </div>
    );
  }
  if (!user) return <LoginPage />;
  if (isRecovery) return <ResetPasswordPage />;
  if (!acessoLiberado) return <PaywallPage />;
  return <Dashboard />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
