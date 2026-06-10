import React from 'react';

function fmt(val) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

export default function BalanceCards({ summary }) {
  const { total_income, total_expense, balance } = summary;

  return (
    <div className="px-4 py-4 grid grid-cols-3 gap-3">
      <Card label="Entradas" value={total_income} color="text-income" />
      <Card label="Saldo" value={balance} color={balance >= 0 ? 'text-income' : 'text-expense'} large />
      <Card label="Saídas" value={total_expense} color="text-expense" />
    </div>
  );
}

function Card({ label, value, color, large }) {
  return (
    <div className={`bg-surface border border-card rounded-2xl p-3 flex flex-col items-center gap-1 ${large ? 'border-gold/30 scale-105 shadow-lg shadow-gold/10' : ''}`}>
      <span className="text-muted text-xs">{label}</span>
      <span className={`${large ? 'text-sm' : 'text-xs'} font-bold ${color} text-center leading-tight`}>
        {fmt(value)}
      </span>
    </div>
  );
}
