import React, { useState, useCallback, lazy, Suspense, Component, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { toggleHide, useHideVals } from './lib/hideVals';
import LoginPage from './components/LoginPage';
import ResetPasswordPage from './components/ResetPasswordPage';
import PaywallPage from './components/PaywallPage';
import Sidebar from './components/Sidebar';
import TransactionForm from './components/TransactionForm';
import TrialBanner from './components/TrialBanner';
import { useTransactions } from './hooks/useTransactions';

// Code splitting: cada página vira um chunk carregado sob demanda, reduzindo
// drasticamente o bundle inicial (recharts, etc. saem do carregamento inicial).
const Resumo        = lazy(() => import('./pages/Resumo'));
const Despesas      = lazy(() => import('./pages/Dividas'));
const Receitas      = lazy(() => import('./pages/Receitas'));
const Graficos      = lazy(() => import('./pages/Graficos'));
const Anotacoes     = lazy(() => import('./pages/Anotacoes'));
const Planejamento  = lazy(() => import('./pages/Planejamento'));
const CartaoCredito = lazy(() => import('./pages/CartaoCredito'));
const Perfil        = lazy(() => import('./pages/Perfil'));

const PageFallback = () => (
  <div className="flex-1 flex items-center justify-center py-20">
    <div className="w-6 h-6 border-2 rounded-full animate-spin"
      style={{ borderColor: 'rgba(34,197,94,0.2)', borderTopColor: '#22c55e' }} />
  </div>
);

// Captura falhas de carregamento de chunk (ex: 404 após novo deploy ou erro de rede).
// Sem este boundary, um chunk que falha ao baixar deixa a tela completamente branca.
class ChunkErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidUpdate(prevProps) {
    // Reseta o erro quando o filho muda (troca de página ou de mês)
    if (this.state.failed && prevProps.children !== this.props.children) {
      this.setState({ failed: false });
    }
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 py-20 px-6 text-center">
          <p className="text-sm font-semibold" style={{ color: '#f87171' }}>
            Erro ao carregar a página. Verifique sua conexão.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#07090f' }}>
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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

function EyeToggle({ className = '' }) {
  const h = useHideVals();
  return (
    <button onClick={toggleHide} title={h ? 'Mostrar valores' : 'Ocultar valores'}
      className={`w-7 h-7 rounded-lg flex items-center justify-center text-text-3 hover:text-accent hover:bg-white/5 transition ${className}`}>
      {h
        ? <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd"/><path d="M12.454 16.697L9.75 13.992a4 4 0 01-3.742-3.741L2.335 6.578A9.98 9.98 0 00.458 10c1.274 4.057 5.065 7 9.542 7 .847 0 1.669-.105 2.454-.303z"/></svg>
        : <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"/></svg>
      }
    </button>
  );
}

function Dashboard() {
  const { logout } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year,  setYear]  = useState(now.getFullYear());
  const [page,  setPage]  = useState('resumo');
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState('expense');
  const [refreshKey, setRefreshKey] = useState(0);
  const { addTransaction } = useTransactions(month, year);

  const handleAddTransaction = useCallback(async (data) => {
    await addTransaction(data);
    setRefreshKey(k => k + 1);
  }, [addTransaction]);

  const prevMonth = useCallback(() => {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }, [month]);
  const nextMonth = useCallback(() => {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }, [month]);
  const goToToday = useCallback(() => { const n = new Date(); setMonth(n.getMonth() + 1); setYear(n.getFullYear()); }, []);
  const goToPerfil = useCallback(() => setPage('perfil'), []);

  // Auto-logout após 10 min de inatividade
  useEffect(() => {
    const TIMEOUT = 10 * 60 * 1000;
    let timer = setTimeout(logout, TIMEOUT);
    const reset = () => { clearTimeout(timer); timer = setTimeout(logout, TIMEOUT); };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach(e => document.addEventListener(e, reset, { passive: true }));
    return () => { clearTimeout(timer); events.forEach(e => document.removeEventListener(e, reset)); };
  }, [logout]);

  const showFab = page === 'resumo';

  return (
    <div className="flex min-h-screen" style={{ background: '#0f172a' }}>
      <Sidebar page={page} setPage={setPage} month={month} year={year} onPrev={prevMonth} onNext={nextMonth} onToday={goToToday} />

      <main className="flex-1 flex flex-col overflow-hidden md:pl-0">
        <TrialBanner onClickPlanos={goToPerfil} />

        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-20 flex flex-col flex-shrink-0"
          style={{ background: 'rgba(15,23,42,0.92)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(34,197,94,0.12)' }}>
          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-text-1 font-bold text-base">{PAGE_TITLES[page]}</span>
            <div className="flex items-center gap-1.5">
              <EyeToggle />
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
          <ChunkErrorBoundary>
            <Suspense fallback={<PageFallback />}>
              {page === 'resumo'       && <Resumo key={refreshKey} month={month} year={year} />}
              {page === 'transacoes'   && <TransacoesWrapper key={refreshKey} month={month} year={year} />}
              {page === 'planejamento' && <Planejamento key={refreshKey} month={month} year={year} />}
              {page === 'graficos'     && <Graficos key={refreshKey} month={month} year={year} />}
              {page === 'anotacoes'    && <Anotacoes />}
              {page === 'perfil'       && <Perfil />}
            </Suspense>
          </ChunkErrorBoundary>
        </div>
      </main>

      {/* FAB */}
      {showFab && (
        <button
          onClick={() => { setFormType('expense'); setShowForm(true); }}
          className="fixed fab-safe right-5 md:right-8 w-14 h-14 rounded-full text-[#07090f] text-2xl font-bold shadow-xl flex items-center justify-center active:scale-90 transition-all duration-150 z-30"
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
  const { user, loading, acessoLiberado, perfilStatus, retryPerfil, isRecovery, refreshPerfil } = useAuth();

  const [waitingPayment, setWaitingPayment] = useState(() =>
    new URLSearchParams(window.location.search).get('pagamento') === 'sucesso'
  );

  React.useEffect(() => {
    if (!waitingPayment || !user) return;
    if (acessoLiberado) {
      setWaitingPayment(false);
      window.history.replaceState({}, '', '/');
      return;
    }
    const interval = setInterval(refreshPerfil, 3000);
    const timeout  = setTimeout(() => { clearInterval(interval); setWaitingPayment(false); }, 45_000);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [waitingPayment, user, acessoLiberado, refreshPerfil]);

  // Spinner enquanto auth/sync carrega OU enquanto aguarda ativação do pagamento.
  // TAMBÉM exibe spinner enquanto perfilStatus === 'loading' (fail-closed: acesso negado durante fetch).
  const isLoading = loading || (user && perfilStatus === 'loading') || (waitingPayment && !acessoLiberado && !!user);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
        <div className="flex flex-col items-center gap-4">
          <img src="/img/logo/logo-app-icon.png" alt="Planeje" className="w-32 h-32 object-contain rounded-3xl" />
          {waitingPayment && (
            <p className="text-sm font-semibold animate-pulse" style={{ color: '#22c55e' }}>
              Ativando seu plano...
            </p>
          )}
          <div className="w-6 h-6 border-2 rounded-full animate-spin"
            style={{ borderColor: 'rgba(34,197,94,0.2)', borderTopColor: '#22c55e' }} />
        </div>
      </div>
    );
  }
  if (!user) return <LoginPage />;
  if (isRecovery) return <ResetPasswordPage />;
  // Falha definitiva ao buscar perfil: exibe tela de erro com retry (acesso negado).
  // NUNCA trata falha de rede como assinatura válida.
  if (user && perfilStatus === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0f172a' }}>
        <div className="flex flex-col items-center gap-5 text-center px-6">
          <img src="/img/logo/logo-app-icon.png" alt="Planeje" className="w-24 h-24 object-contain rounded-3xl opacity-60" />
          <p className="text-base font-semibold" style={{ color: '#f87171' }}>
            Erro ao verificar assinatura. Tente novamente.
          </p>
          <button
            onClick={retryPerfil}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#07090f' }}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }
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
