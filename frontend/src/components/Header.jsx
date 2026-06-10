import React from 'react';
import { useAuth } from '../context/AuthContext';

const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

export default function Header({ month, year, onPrev, onNext }) {
  const { user, logout } = useAuth();

  return (
    <header className="bg-surface sticky top-0 z-20 px-4 py-3 flex items-center justify-between border-b border-card">
      <div
        className="w-8 h-8 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center cursor-pointer"
        onClick={logout}
        title="Sair"
      >
        <span className="text-gold text-xs font-bold">
          {user?.name?.charAt(0).toUpperCase()}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onPrev}
          className="text-gold text-xl px-1 active:scale-90 transition-transform"
        >
          ‹
        </button>
        <span className="text-white font-semibold text-base w-32 text-center">
          {MONTHS[month - 1]} {year}
        </span>
        <button
          onClick={onNext}
          className="text-gold text-xl px-1 active:scale-90 transition-transform"
        >
          ›
        </button>
      </div>

      <div className="w-8" />
    </header>
  );
}
