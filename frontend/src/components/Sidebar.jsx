import React from 'react';
import { useAuth } from '../context/AuthContext';

const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const NAV = [
  { id: 'resumo',       label: 'Resumo',      icon: HomeIcon      },
  { id: 'transacoes',   label: 'Transações',  icon: DebtIcon      },
  { id: 'planejamento', label: 'Planejamento', icon: PlanIcon      },
  { id: 'graficos',     label: 'Gráficos',    icon: ChartIcon     },
  { id: 'anotacoes',    label: 'Anotações',   icon: NoteIcon      },
  { id: 'perfil',       label: 'Perfil',      icon: UserIcon      },
];

export default function Sidebar({ page, setPage, month, year, onPrev, onNext, onToday }) {
  const { user, logout } = useAuth();

  return (
    <>
      {/* ─── Desktop sidebar ─── */}
      <aside className="hidden md:flex flex-col w-[220px] min-h-screen flex-shrink-0 relative"
        style={{
          background: 'linear-gradient(180deg, #1a2535 0%, #0f172a 100%)',
          borderRight: '1px solid rgba(34,197,94,0.12)',
        }}>

        <div className="absolute top-0 left-0 right-0 h-40 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 50% -20%, rgba(34,197,94,0.1) 0%, transparent 70%)' }} />

        {/* Logo */}
        <div className="relative px-4 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <img src="/img/logo/logo-app-icon.png" alt="Planeje"
              className="w-10 h-10 object-contain flex-shrink-0" />
            <div>
              <p className="text-white font-bold text-xl leading-none tracking-tight" style={{ fontFamily: 'Poppins, sans-serif' }}>planeje</p>
              <p className="text-accent text-[8px] font-semibold tracking-wider uppercase leading-tight mt-0.5 whitespace-nowrap">Suas Finanças, Seu Futuro.</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-3 px-0.5">
            <div className="w-1.5 h-1.5 rounded-full bg-income flex-shrink-0" />
            <p className="text-text-3 text-[10px] truncate">{user?.name || 'Usuário'}</p>
          </div>
        </div>

        {/* Período */}
        <div className="mx-3 mb-4 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(34,197,94,0.1)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-text-3 text-[9px] uppercase tracking-widest font-semibold">Período</p>
            <button onClick={onToday}
              className="text-[9px] font-semibold px-2 py-0.5 rounded-full transition-all"
              style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.25)' }}>
              Mês Atual
            </button>
          </div>
          <div className="flex items-center justify-between">
            <button onClick={onPrev}
              className="w-6 h-6 rounded-lg flex items-center justify-center text-text-3 hover:text-accent hover:bg-white/5 transition-all">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd"/>
              </svg>
            </button>
            <div className="text-center">
              <p className="text-text-1 text-sm font-semibold leading-tight">{MONTHS[month - 1]}</p>
              <p className="text-text-3 text-[10px]">{year}</p>
            </div>
            <button onClick={onNext}
              className="w-6 h-6 rounded-lg flex items-center justify-center text-text-3 hover:text-accent hover:bg-white/5 transition-all">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4-4a1 1 0 01-1.414 0z" clipRule="evenodd"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => {
            const active = page === id;
            return (
              <button key={id} onClick={() => setPage(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 text-left relative overflow-hidden group ${
                  active ? 'text-white' : 'text-text-3 hover:text-text-2 hover:bg-white/3'
                }`}
                style={active ? {
                  background: 'rgba(34,197,94,0.15)',
                  border: '1px solid rgba(34,197,94,0.25)',
                } : { border: '1px solid transparent' }}>
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                    style={{ background: 'linear-gradient(180deg, #22c55e, #16a34a)' }} />
                )}
                <span className={`w-4 h-4 flex-shrink-0 transition-colors ${active ? 'text-accent' : 'group-hover:text-text-2'}`}>
                  <Icon />
                </span>
                <span className="flex-1">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-3 pb-5 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <button onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-text-3 hover:text-expense hover:bg-expense/5 transition-all text-sm font-medium"
            style={{ border: '1px solid transparent' }}>
            <LogoutIcon />
            Sair da conta
          </button>
        </div>
      </aside>

      {/* ─── Mobile bottom bar ─── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex"
        style={{ background: 'rgba(15,23,42,0.96)', backdropFilter: 'blur(20px)', borderTop: '1px solid rgba(34,197,94,0.12)' }}>
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return (
            <button key={id} onClick={() => setPage(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[8px] font-semibold tracking-wide uppercase transition-colors ${active ? 'text-accent' : 'text-text-3'}`}>
              <span className={`w-5 h-5 transition-transform ${active ? 'scale-110' : ''}`}><Icon /></span>
              {label === 'Planejamento' ? 'Planejar' : label === 'Transações' ? 'Transações' : label}
            </button>
          );
        })}
      </nav>
    </>
  );
}

function HomeIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full"><path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h4a1 1 0 001-1v-3h2v3a1 1 0 001 1h4a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" /></svg>;
}
function ChartIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" /></svg>;
}
function DebtIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full"><path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>;
}
function PlanIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd"/></svg>;
}
function NoteIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg>;
}
function UserIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-full h-full"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd"/></svg>;
}
function LogoutIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4"><path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" /></svg>;
}
